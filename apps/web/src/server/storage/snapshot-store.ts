import { createHash } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import type Database from "better-sqlite3";

/** Quality 6: ~100x smaller for capture JSON, ~0.2 s to compress and ~0.02 s to read a large capture. */
const brotliOptions = { params: { [constants.BROTLI_PARAM_QUALITY]: 6, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT } };

/** Bump when frameDesignHash changes, so stored indexes are recomputed on the next start. */
const designHashVersion = 3;

type IndexedFrame = { sourceFrameId?: string; name?: string; renderAssetKey?: string; bounds?: unknown; nodes?: Array<Record<string, unknown>> };


/**
 * Normalizes numbers so Figma's float noise (193.66667 vs 193.66699, which can straddle any fine
 * rounding line) isn't a "change": pixel measurements ({ value, unit: "px" }) round to the nearest
 * half pixel, and every other number (opacity, colors, percentages) to 0.001.
 */
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

/** The small per-screen index kept beside a compressed capture, so comparisons can run in SQLite. */
export function frameIndexFor(snapshotJson: string) {
  const parsed = JSON.parse(snapshotJson) as { frames?: IndexedFrame[] };
  return JSON.stringify(
    (parsed.frames ?? []).map((frame) => ({
      sourceFrameId: frame.sourceFrameId,
      name: frame.name,
      renderAssetKey: frame.renderAssetKey,
      designHash: frameDesignHash(frame),
      designHashVersion: designHashVersion,
    })),
  );
}

/** Compresses capture JSON and proves the result reads back to the exact same text. */
export function compressSnapshotJson(snapshotJson: string) {
  const raw = Buffer.from(snapshotJson, "utf8");
  const compressed = brotliCompressSync(raw, brotliOptions);
  if (!brotliDecompressSync(compressed).equals(raw)) throw new Error("Compressed capture did not read back identically.");
  return { encoding: "br" as const, compressed, rawBytes: raw.length, frameIndex: frameIndexFor(snapshotJson) };
}

export function decompressSnapshot(encoding: string, compressed: Buffer) {
  if (encoding !== "br") throw new Error(`Unknown capture encoding "${encoding}".`);
  return brotliDecompressSync(compressed).toString("utf8");
}

/** Writes the compressed copy of a version's capture (inside the caller's transaction). */
export function storeCompressedSnapshot(database: Database.Database, versionId: string, snapshotJson: string) {
  const stored = compressSnapshotJson(snapshotJson);
  database
    .prepare(
      `INSERT INTO handoff_version_snapshot (version_id, encoding, compressed, raw_bytes, frame_index)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(versionId, stored.encoding, stored.compressed, stored.rawBytes, stored.frameIndex);
}

/**
 * Compresses captures still stored as plain text (from before compression, or added by scripts), one
 * at a time to keep memory flat. Each is verified before its plain copy is replaced with '{}'.
 */
export function compressStoredSnapshots(database: Database.Database) {
  const pending = database
    .prepare(
      `SELECT handoff_version.id FROM handoff_version
       LEFT JOIN handoff_version_snapshot ON handoff_version_snapshot.version_id = handoff_version.id
       WHERE handoff_version.snapshot_json <> '{}' OR handoff_version_snapshot.version_id IS NULL`,
    )
    .all() as Array<{ id: string }>;
  if (!pending.length) return 0;
  const read = database.prepare("SELECT snapshot_json AS snapshotJson FROM handoff_version WHERE id = ?");
  const hasCopy = database.prepare("SELECT 1 FROM handoff_version_snapshot WHERE version_id = ?");
  const clear = database.prepare("UPDATE handoff_version SET snapshot_json = '{}' WHERE id = ?");
  let compressed = 0;
  for (const { id } of pending) {
    const { snapshotJson } = read.get(id) as { snapshotJson: string };
    if (snapshotJson === "{}") continue;
    database.transaction(() => {
      if (!hasCopy.get(id)) storeCompressedSnapshot(database, id, snapshotJson);
      clear.run(id);
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
export function refreshFrameIndexes(database: Database.Database) {
  const stale = database
    .prepare(
      `SELECT version_id AS versionId, encoding, compressed FROM handoff_version_snapshot
       WHERE json_array_length(frame_index) > 0
         AND COALESCE(json_extract(frame_index, '$[0].designHashVersion'), 0) < ${designHashVersion}`,
    )
    .all() as Array<{ versionId: string; encoding: string; compressed: Buffer }>;
  const update = database.prepare("UPDATE handoff_version_snapshot SET frame_index = ? WHERE version_id = ?");
  for (const row of stale) update.run(frameIndexFor(decompressSnapshot(row.encoding, row.compressed)), row.versionId);
  if (stale.length) console.info(`[storage] Added design fingerprints to ${stale.length} ${stale.length === 1 ? "capture" : "captures"}.`);
  return stale.length;
}

/** A version's capture JSON, whichever way it is stored. */
export function readSnapshotJson(database: Database.Database, versionId: string, workspaceId: string) {
  const row = database
    .prepare(
      `SELECT handoff_version.snapshot_json AS snapshotJson, handoff_version_snapshot.encoding, handoff_version_snapshot.compressed
       FROM handoff_version
       LEFT JOIN handoff_version_snapshot ON handoff_version_snapshot.version_id = handoff_version.id
       WHERE handoff_version.id = ? AND handoff_version.workspace_id = ?`,
    )
    .get(versionId, workspaceId) as { snapshotJson: string; encoding: string | null; compressed: Buffer | null } | undefined;
  if (!row) return null;
  return row.compressed && row.encoding ? decompressSnapshot(row.encoding, row.compressed) : row.snapshotJson;
}
