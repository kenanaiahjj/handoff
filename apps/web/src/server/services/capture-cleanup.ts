import { getDatabase } from "../db";
import { objectStore } from "../storage/supabase-object-store";

/** A capture session can be renewed for up to 24 hours; past this, its unfinished uploads are dead. */
const UNFINISHED_UPLOAD_GRACE_MS = 25 * 60 * 60 * 1000;

/**
 * Deletes capture uploads that will never become part of a version: slots replaced by a renewal
 * (once their grace period ends) and uploads of captures that were never finalized. An object any
 * version refers to is never deleted. Runs from the daily cron; each run handles a bounded batch.
 */
export async function cleanupCaptureUploads(options: { now?: Date; limit?: number } = {}) {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 500;
  const database = getDatabase();

  const abandoned = (await database
    .prepare("SELECT object_key AS objectKey FROM capture_upload_abandoned WHERE delete_after <= ? ORDER BY delete_after LIMIT ?")
    .all(now.toISOString(), limit)) as Array<{ objectKey: string }>;
  const unfinished = (await database
    .prepare(
      `SELECT capture_upload.id, capture_upload.object_key AS objectKey
       FROM capture_upload
       JOIN capture_session ON capture_session.id = capture_upload.capture_session_id
       WHERE capture_upload.finalized_at IS NULL
         AND capture_session.used_at IS NULL
         AND capture_session.created_at < ?
       ORDER BY capture_session.created_at
       LIMIT ?`,
    )
    .all(new Date(now.getTime() - UNFINISHED_UPLOAD_GRACE_MS).toISOString(), limit)) as Array<{ id: string; objectKey: string }>;

  const keys = [...new Set([...abandoned, ...unfinished].map((row) => row.objectKey))];
  if (!keys.length) return { deletedObjects: 0, keptInUse: 0, failed: 0 };

  const inUse = new Set(((await database
    .prepare("SELECT DISTINCT object_key AS objectKey FROM handoff_asset WHERE object_key = ANY(?)")
    .all([keys])) as Array<{ objectKey: string }>).map((row) => row.objectKey));
  const toDelete = keys.filter((key) => !inUse.has(key));
  const results = await Promise.allSettled(toDelete.map((key) => objectStore.delete(key)));
  const deleted = new Set(toDelete.filter((_, index) => results[index].status === "fulfilled"));
  const failed = toDelete.length - deleted.size;
  if (failed) console.warn(`[capture cleanup] Could not delete ${failed} capture upload(s); they are retried next run.`);

  // Forget rows whose object is gone or belongs to a version; failed deletes stay for the next run.
  const settled = (key: string) => deleted.has(key) || inUse.has(key);
  const abandonedDone = abandoned.filter((row) => settled(row.objectKey)).map((row) => row.objectKey);
  if (abandonedDone.length) {
    await database.prepare("DELETE FROM capture_upload_abandoned WHERE object_key = ANY(?)").run([abandonedDone]);
  }
  const unfinishedDone = unfinished.filter((row) => settled(row.objectKey)).map((row) => row.id);
  if (unfinishedDone.length) {
    await database.prepare("DELETE FROM capture_upload WHERE id = ANY(?) AND finalized_at IS NULL").run([unfinishedDone]);
  }
  return { deletedObjects: deleted.size, keptInUse: keys.length - toDelete.length, failed };
}
