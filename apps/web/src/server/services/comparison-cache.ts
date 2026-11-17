import { createHash } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { getDatabase } from "../db";

/** Keep the most recent comparisons; each is a few hundred KB compressed at most. */
const maxEntries = 300;

/**
 * Fingerprint of every confirmed screen and layer match in a handoff. A new or removed match changes
 * it, so a saved comparison is never served after the matches it was computed with have changed.
 */
export function matchStateKey(handoffId: string) {
  const database = getDatabase();
  const frames = database
    .prepare(
      `SELECT baseline_version_id, new_version_id, before_frame_id, after_frame_id
       FROM handoff_frame_replacement WHERE handoff_id = ?
       ORDER BY new_version_id, before_frame_id`,
    )
    .all(handoffId);
  const nodes = database
    .prepare(
      `SELECT baseline_version_id, new_version_id, before_frame_id, after_frame_id, before_node_id, after_node_id
       FROM handoff_node_replacement WHERE handoff_id = ?
       ORDER BY baseline_version_id, new_version_id, before_frame_id, before_node_id`,
    )
    .all(handoffId);
  return createHash("sha256").update(JSON.stringify({ frames, nodes })).digest("hex");
}

/** The saved comparison as JSON text, ready to send, or null when it hasn't been computed yet. */
export function readSavedComparison(input: { fromVersionId: string; toVersionId: string; matchKey: string }) {
  const row = getDatabase()
    .prepare(
      `SELECT encoding, compressed FROM comparison_cache
       WHERE from_version_id = ? AND to_version_id = ? AND match_key = ?`,
    )
    .get(input.fromVersionId, input.toVersionId, input.matchKey) as { encoding: string; compressed: Buffer } | undefined;
  if (!row || row.encoding !== "br") return null;
  return brotliDecompressSync(row.compressed).toString("utf8");
}

export function saveComparison(input: { handoffId: string; fromVersionId: string; toVersionId: string; matchKey: string; json: string }) {
  const database = getDatabase();
  const compressed = brotliCompressSync(Buffer.from(input.json, "utf8"), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT },
  });
  database.transaction(() => {
    database
      .prepare(
        `INSERT OR REPLACE INTO comparison_cache
          (handoff_id, from_version_id, to_version_id, match_key, encoding, compressed, created_at)
         VALUES (?, ?, ?, ?, 'br', ?, ?)`,
      )
      .run(input.handoffId, input.fromVersionId, input.toVersionId, input.matchKey, compressed, new Date().toISOString());
    database
      .prepare(
        `DELETE FROM comparison_cache WHERE rowid NOT IN (
           SELECT rowid FROM comparison_cache ORDER BY created_at DESC LIMIT ?
         )`,
      )
      .run(maxEntries);
  })();
}
