import { after } from "next/server";
import type { SnapshotEnvelope } from "@asbir/snapshot-contract";
import { getDatabase, type PostgresDatabase } from "../db";
import { getVersion, type StoredSnapshot, type VersionRecord } from "../repositories/versions";
import { hasScreenCopyTables, readChunkedFrame, storeChunkedSnapshot } from "../storage/snapshot-store";

/**
 * Each screen of a structured capture is also kept on its own (compressed, shared between versions
 * when unchanged), so inspecting one screen reads that screen instead of parsing the whole capture.
 * On a 250 MB capture that is the difference between ~1.2 GB and 2-3 s per cold request, and a few
 * kilobytes. The whole capture stays the source of truth: any problem here falls back to it.
 */

function isStructured(snapshot: StoredSnapshot): snapshot is SnapshotEnvelope {
  return !("visualOnly" in snapshot && snapshot.visualOnly) && Array.isArray((snapshot as SnapshotEnvelope).frames);
}

async function hasScreenCopies(database: PostgresDatabase, workspaceId: string, versionId: string) {
  if (!(await hasScreenCopyTables(database))) return false;
  return Boolean(await database
    .prepare("SELECT 1 FROM handoff_snapshot_manifest WHERE version_id = ? AND workspace_id = ?")
    .get(versionId, workspaceId));
}

/** Saves the per-screen copies of a version (skipped if they exist). Never throws. */
export async function storeScreenCopies(workspaceId: string, versionId: string, snapshot: StoredSnapshot) {
  if (!isStructured(snapshot)) return;
  const database = getDatabase();
  try {
    if (!(await hasScreenCopyTables(database)) || await hasScreenCopies(database, workspaceId, versionId)) return;
    await storeChunkedSnapshot(database, workspaceId, versionId, snapshot as unknown as Parameters<typeof storeChunkedSnapshot>[3]);
  } catch (error) {
    // Another request may have saved them first, or the version was deleted meanwhile.
    if (!(await hasScreenCopies(database, workspaceId, versionId).catch(() => false))) {
      console.warn(`[frames] Could not save per-screen copies of version ${versionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Saves the per-screen copies after the response is sent (kept alive on serverless by after()). */
export function storeScreenCopiesLater(workspaceId: string, versionId: string, snapshot: StoredSnapshot) {
  try {
    after(() => storeScreenCopies(workspaceId, versionId, snapshot));
  } catch {
    // Outside a request (scripts, tests): save now instead.
    void storeScreenCopies(workspaceId, versionId, snapshot);
  }
}

/**
 * Full captured elements for one screen: from its own copy when there is one, otherwise from the
 * whole capture (and the copies are then saved for next time). null when the screen isn't in the version.
 */
export async function readScreenNodes(version: VersionRecord, frameId: string) {
  if (version.visualOnly) return [];
  const database = getDatabase();
  try {
    if (await hasScreenCopies(database, version.workspaceId, version.id)) {
      const frame = await readChunkedFrame(database, version.workspaceId, version.id, frameId);
      if (frame) return (frame as unknown as SnapshotEnvelope["frames"][number]).nodes;
    }
  } catch (error) {
    console.warn(`[frames] Reading screen ${frameId} of version ${version.id} from the whole capture instead: ${error instanceof Error ? error.message : String(error)}`);
  }
  const full = await getVersion({ workspaceId: version.workspaceId, versionId: version.id });
  if (!full || !isStructured(full.snapshot)) return full ? [] : null;
  storeScreenCopiesLater(version.workspaceId, version.id, full.snapshot);
  return full.snapshot.frames.find((frame) => frame.sourceFrameId === frameId)?.nodes ?? null;
}
