import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import type Database from "better-sqlite3";

/** Quality 6: ~100x smaller for capture JSON, ~0.2 s to compress and ~0.02 s to read a large capture. */
const brotliOptions = { params: { [constants.BROTLI_PARAM_QUALITY]: 6, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT } };

/** The small per-screen index kept beside a compressed capture, so comparisons can run in SQLite. */
export function frameIndexFor(snapshotJson: string) {
  const parsed = JSON.parse(snapshotJson) as { frames?: Array<{ sourceFrameId?: string; name?: string; renderAssetKey?: string }> };
  return JSON.stringify(
    (parsed.frames ?? []).map((frame) => ({ sourceFrameId: frame.sourceFrameId, name: frame.name, renderAssetKey: frame.renderAssetKey })),
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
