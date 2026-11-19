import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { brotliCompressSync, brotliDecompressSync, createBrotliCompress, createBrotliDecompress, constants } from "node:zlib";
import type { PostgresDatabase } from "../db";

/** Quality 6: ~100x smaller for capture JSON, ~0.2 s to compress and ~0.02 s to read a large capture. */
const brotliOptions = { params: { [constants.BROTLI_PARAM_QUALITY]: 6, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT } };

/** Bump when frameDesignHash changes so the explicit index-refresh task can rebuild stored indexes. */
const designHashVersion = 3;

type IndexedFrame = { sourceFrameId?: string; name?: string; renderAssetKey?: string; bounds?: unknown; nodes?: Array<Record<string, unknown>> };

function normalizeNumbers(value: unknown): unknown {
  if (typeof value === "number") return Math.round(value * 1000) / 1000;
  if (Array.isArray(value)) return value.map(normalizeNumbers);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.unit === "px" && typeof record.value === "number") {
      return { ...record, value: Math.round(record.value * 2) / 2 };
    }
    return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, normalizeNumbers(entry)]));
  }
  return value;
}


/**
 * Normalizes numbers so Figma's float noise (193.66667 vs 193.66699, which can straddle any fine
 * rounding line) isn't a "change": pixel measurements ({ value, unit: "px" }) round to the nearest
 * half pixel, and every other number (opacity, colors, percentages) to 0.001.
 */
/**
 * A fingerprint of a screen's design: its size plus every layer's measurements, layout and styles.
 * Left out on purpose, because none of them change what a developer builds: layer and screen names
 * (renames), the screen's position on the Figma canvas (moving screens around), pointers to exported
 * image files, and float noise below half a pixel. Screens without design data (visual-only uploads) return
 * null and are compared by their image instead.
 */
export function frameDesignHash(frame: IndexedFrame) {
  if (!Array.isArray(frame.nodes) || !frame.nodes.length) return null;
  const bounds = (frame.bounds ?? {}) as Record<string, unknown>;
  const nodes = frame.nodes.map((node) => {
    const rest: Record<string, unknown> = { ...node };
    delete rest.name;
    if (rest.sourcePayload && typeof rest.sourcePayload === "object") {
      const payload = { ...(rest.sourcePayload as Record<string, unknown>) };
      delete payload.layerExportAssetKey;
      rest.sourcePayload = payload;
    }
    return rest;
  });
  const design = { width: normalizeNumbers(bounds.width), height: normalizeNumbers(bounds.height), nodes };
  return createHash("sha256").update(JSON.stringify(normalizeNumbers(design))).digest("hex");
}

/** The small per-screen index kept beside a compressed capture for PostgreSQL comparisons. */
export function frameIndexFor(snapshotJson: string) {
  return frameIndexForFrames((JSON.parse(snapshotJson) as { frames?: IndexedFrame[] }).frames);
}

/** frameIndexFor, from frames already in memory (saves parsing a large capture a second time). */
export function frameIndexForFrames(frames: readonly IndexedFrame[] | undefined) {
  return JSON.stringify(
    (frames ?? []).map((frame) => ({
      sourceFrameId: frame.sourceFrameId,
      name: frame.name,
      renderAssetKey: frame.renderAssetKey,
      designHash: frameDesignHash(frame),
      designHashVersion: designHashVersion,
    })),
  );
}

/** Compresses capture JSON and proves the result reads back to the exact same text. */
export function compressSnapshotJson(snapshotJson: string, frames?: readonly IndexedFrame[]) {
  const raw = Buffer.from(snapshotJson, "utf8");
  const compressed = brotliCompressSync(raw, brotliOptions);
  if (!brotliDecompressSync(compressed).equals(raw)) throw new Error("Compressed capture did not read back identically.");
  const frameIndex = frames ? frameIndexForFrames(frames) : frameIndexFor(snapshotJson);
  return { encoding: "br" as const, compressed, rawBytes: raw.length, frameIndex };
}

export type CompressedSnapshot = ReturnType<typeof compressSnapshotJson>;

export class SnapshotSizeLimitError extends Error {
  constructor(maxRawBytes: number) {
    super(`Snapshot exceeds the ${maxRawBytes} byte limit.`);
    this.name = "SnapshotSizeLimitError";
  }
}

/** Serializes top-level arrays one item at a time, using native JSON serialization for each item. */
function* snapshotJsonChunks(
  snapshot: Record<string, unknown>,
  onChunk: (chunk: Buffer) => void,
  onComplete: () => void,
): Generator<Buffer> {
  const encode = (text: string) => {
    const chunk = Buffer.from(text, "utf8");
    onChunk(chunk);
    return chunk;
  };
  const keys = Object.keys(snapshot).filter((key) => snapshot[key] !== undefined);
  yield encode("{");
  for (const [index, key] of keys.entries()) {
    if (index) yield encode(",");
    yield encode(JSON.stringify(key));
    yield encode(":");
    const value = snapshot[key];
    if (Array.isArray(value)) {
      yield encode("[");
      for (const [itemIndex, item] of value.entries()) {
        if (itemIndex) yield encode(",");
        yield encode(JSON.stringify(item) ?? "null");
      }
      yield encode("]");
      continue;
    }
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError("Snapshot payloads must contain JSON-compatible values.");
    yield encode(json);
  }
  yield encode("}");
  onComplete();
}

/** Streams frame-wise native JSON serialization through Brotli to avoid a full-size JSON copy. */
export async function compressSnapshot(
  snapshot: { frames?: readonly IndexedFrame[] },
  options: { maxRawBytes?: number; quality?: number; onStage?: (stage: string) => void } = {},
) {
  const quality = options.quality ?? 6;
  if (!Number.isInteger(quality) || quality < 0 || quality > 11) {
    throw new RangeError("Brotli quality must be an integer from 0 through 11.");
  }
  const compressionOptions = options.quality === undefined ? brotliOptions : {
    params: { ...brotliOptions.params, [constants.BROTLI_PARAM_QUALITY]: quality },
  };
  const compressedChunks: Buffer[] = [];
  const collectCompressed = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      compressedChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });
  const inputHash = createHash("sha256");
  let rawBytes = 0;
  const trackInput = (chunk: Buffer) => {
    rawBytes += chunk.byteLength;
    if (options.maxRawBytes !== undefined && rawBytes > options.maxRawBytes) {
      throw new SnapshotSizeLimitError(options.maxRawBytes);
    }
    inputHash.update(chunk);
  };
  options.onStage?.("json_stream_started");
  await pipeline(
    Readable.from(snapshotJsonChunks(snapshot as Record<string, unknown>, trackInput, () => options.onStage?.("json_stream_complete")), { objectMode: false }),
    createBrotliCompress(compressionOptions),
    collectCompressed,
  );
  options.onStage?.("brotli_encode_complete");
  const expectedHash = inputHash.digest("hex");
  const compressed = Buffer.concat(compressedChunks);
  compressedChunks.length = 0;

  const outputHash = createHash("sha256");
  let outputBytes = 0;
  const verifyOutput = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += bytes.byteLength;
      outputHash.update(bytes);
      callback();
    },
  });
  await pipeline(Readable.from([compressed]), createBrotliDecompress(), verifyOutput);
  if (outputBytes !== rawBytes || outputHash.digest("hex") !== expectedHash) {
    throw new Error("Compressed capture did not read back identically.");
  }
  options.onStage?.("round_trip_verified");

  const frameIndex = frameIndexForFrames(snapshot.frames ?? []);
  options.onStage?.("frame_index_complete");

  return {
    encoding: "br" as const,
    compressed,
    rawBytes,
    frameIndex,
  };
}

export function decompressSnapshot(encoding: string, compressed: Buffer) {
  if (encoding !== "br") throw new Error(`Unknown capture encoding "${encoding}".`);
  return brotliDecompressSync(compressed).toString("utf8");
}

type ChunkedFrame = { sourceFrameId: string; [key: string]: unknown };
type ChunkedSnapshot = { frames: ChunkedFrame[]; [key: string]: unknown };
type StoredFrameChunk = { compressed: Buffer; rawBytes: number; contentHash: string };

/** The manifest and its screen references are committed together, including within a caller's transaction. */
export async function storeChunkedSnapshot(database: PostgresDatabase, workspaceId: string, versionId: string, snapshot: ChunkedSnapshot) {
  return database.transaction(async () => {
    const { frames, ...metadata } = snapshot;
    await database.prepare(`INSERT INTO handoff_snapshot_manifest (version_id, workspace_id, metadata_json, frame_count)
      VALUES (?, ?, ?, ?)`).run(versionId, workspaceId, JSON.stringify(metadata), frames.length);
    const insertChunk = database.prepare(`INSERT INTO handoff_snapshot_frame_chunk (workspace_id, content_hash, compressed, raw_bytes)
      VALUES (?, ?, ?, ?) ON CONFLICT (workspace_id, content_hash) DO NOTHING`);
    const existingChunk = database.prepare(`SELECT compressed, raw_bytes AS rawBytes, content_hash AS contentHash
      FROM handoff_snapshot_frame_chunk WHERE workspace_id = ? AND content_hash = ?`);
    const insertRef = database.prepare(`INSERT INTO handoff_snapshot_frame_ref (version_id, workspace_id, frame_position, frame_id, content_hash)
      VALUES (?, ?, ?, ?, ?)`);
    for (const [position, frame] of frames.entries()) {
      if (!frame.sourceFrameId) throw new Error("Every chunked screen must have a source frame ID.");
      const raw = Buffer.from(JSON.stringify(frame), "utf8");
      const digest = createHash("sha256").update(raw).digest("hex");
      let existing = await existingChunk.get(workspaceId, digest) as StoredFrameChunk | undefined;
      if (!existing) {
        const compressed = brotliCompressSync(raw, brotliOptions);
        if (!brotliDecompressSync(compressed).equals(raw)) throw new Error("Compressed screen did not read back identically.");
        const inserted = await insertChunk.run(workspaceId, digest, compressed, raw.length);
        if (!inserted.changes) {
          existing = await existingChunk.get(workspaceId, digest) as StoredFrameChunk | undefined;
          if (!existing) throw new Error("The shared screen chunk could not be read.");
        }
      }
      if (existing) decodeFrameChunk(existing);
      await insertRef.run(versionId, workspaceId, position, frame.sourceFrameId, digest);
    }
  })();
}

function decodeFrameChunk(row: StoredFrameChunk) {
  const raw = brotliDecompressSync(row.compressed);
  if (raw.length !== Number(row.rawBytes) || createHash("sha256").update(raw).digest("hex") !== row.contentHash) {
    throw new Error("Stored screen chunk failed its integrity check.");
  }
  return JSON.parse(raw.toString("utf8")) as ChunkedFrame;
}

export async function readChunkedFrame(database: PostgresDatabase, workspaceId: string, versionId: string, frameId: string) {
  const row = await database.prepare(`SELECT c.compressed, c.raw_bytes AS rawBytes, c.content_hash AS contentHash
    FROM handoff_snapshot_frame_ref r JOIN handoff_snapshot_frame_chunk c
      ON c.workspace_id = r.workspace_id AND c.content_hash = r.content_hash
    WHERE r.workspace_id = ? AND r.version_id = ? AND r.frame_id = ?`).get(workspaceId, versionId, frameId) as
    StoredFrameChunk | undefined;
  if (!row) return null;
  const frame = decodeFrameChunk(row);
  if (frame.sourceFrameId !== frameId) throw new Error("Stored screen chunk does not match its reference.");
  return frame;
}

/** Writes the compressed copy of a version's capture (inside the caller's transaction). */
export async function storeCompressedSnapshot(database: PostgresDatabase, versionId: string, snapshotJson: string | CompressedSnapshot) {
  const stored = typeof snapshotJson === "string" ? compressSnapshotJson(snapshotJson) : snapshotJson;
  (await database
    .prepare(
      `INSERT INTO handoff_version_snapshot (version_id, encoding, compressed, raw_bytes, frame_index)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(versionId, stored.encoding, stored.compressed, stored.rawBytes, stored.frameIndex));
}

/**
 * Compresses captures still stored as plain text (from before compression, or added by scripts), one
 * at a time to keep memory flat. Each is verified before its plain copy is replaced with '{}'.
 */
export async function compressStoredSnapshots(database: PostgresDatabase) {
  const pending = (await database
    .prepare(
      `SELECT handoff_version.id FROM handoff_version
       LEFT JOIN handoff_version_snapshot ON handoff_version_snapshot.version_id = handoff_version.id
       WHERE handoff_version.snapshot_json <> '{}' OR handoff_version_snapshot.version_id IS NULL`,
    )
    .all()) as Array<{ id: string }>;
  if (!pending.length) return 0;
  const read = database.prepare("SELECT snapshot_json AS snapshotJson FROM handoff_version WHERE id = ?");
  const hasCopy = database.prepare("SELECT 1 FROM handoff_version_snapshot WHERE version_id = ?");
  const clear = database.prepare("UPDATE handoff_version SET snapshot_json = '{}' WHERE id = ?");
  let compressed = 0;
  for (const { id } of pending) {
    const { snapshotJson } = (await read.get(id)) as { snapshotJson: string };
    if (snapshotJson === "{}") continue;
    await database.transaction(async () => {
      if (!(await hasCopy.get(id))) await storeCompressedSnapshot(database, id, snapshotJson);
      await clear.run(id);
    })();
    compressed += 1;
  }
  if (compressed) console.info(`[storage] Compressed ${compressed} stored ${compressed === 1 ? "capture" : "captures"}.`);
  return compressed;
}

/**
 * Adds design fingerprints to screen indexes written before they existed (one pass, on start).
 * Compressed rows can be updated freely: only the version row itself is immutable.
 */
export async function refreshFrameIndexes(database: PostgresDatabase) {
  const stale = (await database
    .prepare(
      `SELECT version_id AS versionId, encoding, compressed, frame_index AS frameIndex FROM handoff_version_snapshot
       WHERE frame_index <> '[]'`,
    )
    .all()) as Array<{ versionId: string; encoding: string; compressed: Buffer; frameIndex: string }>;
  const update = database.prepare("UPDATE handoff_version_snapshot SET frame_index = ? WHERE version_id = ?");
  let refreshed = 0;
  for (const row of stale) {
    const indexes = JSON.parse(row.frameIndex) as Array<{ designHashVersion?: number }>;
    if ((indexes[0]?.designHashVersion ?? 0) >= designHashVersion) continue;
    const snapshotJson = decompressSnapshot(row.encoding, row.compressed);
    await update.run(frameIndexFor(snapshotJson), row.versionId);
    refreshed += 1;
  }
  if (refreshed) console.info(`[storage] Added design fingerprints to ${refreshed} ${refreshed === 1 ? "capture" : "captures"}.`);
  return refreshed;
}

/** Reads a chunked version for consumers that support the new format. */
export async function readChunkedSnapshotJson(database: PostgresDatabase, versionId: string, workspaceId: string) {
  const manifest = await database.prepare(`SELECT metadata_json AS metadataJson, frame_count AS frameCount
    FROM handoff_snapshot_manifest WHERE version_id = ? AND workspace_id = ?`).get(versionId, workspaceId) as
    { metadataJson: string; frameCount: number } | undefined;
  if (manifest) {
    const rows = await database.prepare(`SELECT c.compressed, c.raw_bytes AS rawBytes, c.content_hash AS contentHash,
        r.frame_position AS framePosition, r.frame_id AS frameId
      FROM handoff_snapshot_frame_ref r JOIN handoff_snapshot_frame_chunk c
        ON c.workspace_id = r.workspace_id AND c.content_hash = r.content_hash
      WHERE r.version_id = ? AND r.workspace_id = ? ORDER BY r.frame_position`).all(versionId, workspaceId) as
      Array<StoredFrameChunk & { framePosition: number; frameId: string }>;
    if (rows.length !== Number(manifest.frameCount)) throw new Error("Stored capture is missing screen chunks.");
    const frames = rows.map((row, position) => {
      const frame = decodeFrameChunk(row);
      if (Number(row.framePosition) !== position || frame.sourceFrameId !== row.frameId) throw new Error("Stored screen chunk does not match its reference.");
      return frame;
    });
    return JSON.stringify({ ...JSON.parse(manifest.metadataJson), frames });
  }
  return null;
}

/** A version's capture JSON, whichever legacy format it is stored in. */
export async function readSnapshotJson(database: PostgresDatabase, versionId: string, workspaceId: string) {
  const row = (await database
    .prepare(
      `SELECT handoff_version.snapshot_json AS snapshotJson, handoff_version_snapshot.encoding, handoff_version_snapshot.compressed
       FROM handoff_version
       LEFT JOIN handoff_version_snapshot ON handoff_version_snapshot.version_id = handoff_version.id
       WHERE handoff_version.id = ? AND handoff_version.workspace_id = ?`,
    )
    .get(versionId, workspaceId)) as { snapshotJson: string; encoding: string | null; compressed: Buffer | null } | undefined;
  if (!row) return null;
  return row.compressed && row.encoding ? decompressSnapshot(row.encoding, row.compressed) : row.snapshotJson;
}

const screenCopyTablesPresent = new WeakMap<object, boolean>();

/**
 * Whether the per-screen tables exist (migration 20261118010000). A database that hasn't applied it
 * yet keeps working from whole captures; checking first avoids a failed query, which also aborts the
 * surrounding transaction and can upset the local PGlite connection.
 */
export async function hasScreenCopyTables(database: PostgresDatabase) {
  const known = screenCopyTablesPresent.get(database);
  if (known) return true;
  const row = (await database
    .prepare("SELECT to_regclass('public.handoff_snapshot_frame_chunk') IS NOT NULL AS present")
    .get()) as { present: boolean } | undefined;
  const present = Boolean(row?.present);
  // Only a positive answer is remembered: the migration may be applied while the server runs.
  if (present) screenCopyTablesPresent.set(database, true);
  return present;
}

/** Removes stored screens no version refers to any more (after deletions). */
export async function deleteUnreferencedScreenCopies(database: PostgresDatabase, workspaceId: string) {
  if (!(await hasScreenCopyTables(database))) return;
  await database
    .prepare(
      `DELETE FROM handoff_snapshot_frame_chunk
       WHERE workspace_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM handoff_snapshot_frame_ref
           WHERE handoff_snapshot_frame_ref.workspace_id = handoff_snapshot_frame_chunk.workspace_id
             AND handoff_snapshot_frame_ref.content_hash = handoff_snapshot_frame_chunk.content_hash
         )`,
    )
    .run(workspaceId);
}
