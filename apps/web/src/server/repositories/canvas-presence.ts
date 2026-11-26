import { getDatabase } from "../db";
import { isMissingSchema } from "./mcp-clients";

/** A viewer counts as here while their heartbeat is this recent. */
export const presenceWindowMs = 12_000;

export type CanvasViewer = {
  userId: string;
  name: string;
  image: string | null;
  versionId: string;
  screenId: string | null;
  x: number | null;
  y: number | null;
};

/**
 * Records that this person has the handoff open (and where their pointer is), and returns everyone
 * else who has it open right now.
 */
export async function heartbeatCanvasPresence(input: {
  handoffId: string;
  userId: string;
  versionId: string;
  screenId: string | null;
  x: number | null;
  y: number | null;
  now?: Date;
}): Promise<CanvasViewer[]> {
  const now = input.now ?? new Date();
  const database = getDatabase();
  try {
    await database
      .prepare(
        `INSERT INTO canvas_presence (handoff_id, user_id, version_id, screen_id, pointer_x, pointer_y, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (handoff_id, user_id) DO UPDATE SET version_id = EXCLUDED.version_id, screen_id = EXCLUDED.screen_id,
           pointer_x = EXCLUDED.pointer_x, pointer_y = EXCLUDED.pointer_y, updated_at = EXCLUDED.updated_at`,
      )
      .run(input.handoffId, input.userId, input.versionId, input.screenId, input.x, input.y, now.toISOString());
    const rows = (await database
      .prepare(
        `SELECT presence.user_id AS "userId", COALESCE("user".name, '') AS name, "user".image AS image,
                presence.version_id AS "versionId", presence.screen_id AS "screenId",
                presence.pointer_x AS x, presence.pointer_y AS y
         FROM canvas_presence AS presence
         JOIN "user" ON "user".id = presence.user_id
         WHERE presence.handoff_id = ? AND presence.user_id <> ? AND presence.updated_at > ?
         ORDER BY "user".name LIMIT 30`,
      )
      .all(input.handoffId, input.userId, new Date(now.getTime() - presenceWindowMs).toISOString())) as CanvasViewer[];
    return rows.map((row) => ({ ...row, x: row.x === null ? null : Number(row.x), y: row.y === null ? null : Number(row.y) }));
  } catch (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
}

/** Closing the tab: drop the row so others stop seeing you straight away. */
export async function leaveCanvasPresence(handoffId: string, userId: string) {
  try {
    await getDatabase().prepare(`DELETE FROM canvas_presence WHERE handoff_id = ? AND user_id = ?`).run(handoffId, userId);
  } catch (error) {
    if (!isMissingSchema(error)) throw error;
  }
}

/**
 * Notes that this person opened a version and returns the version to compare it with: the one they
 * had open on their previous visit. Reloading the same version keeps that answer.
 */
export async function markHandoffVersionSeen(input: { handoffId: string; userId: string; versionId: string; now?: Date }) {
  const database = getDatabase();
  try {
    const current = (await database
      .prepare(`SELECT last_version_id AS "lastVersionId", baseline_version_id AS "baselineVersionId" FROM handoff_seen_version WHERE handoff_id = ? AND user_id = ?`)
      .get(input.handoffId, input.userId)) as { lastVersionId: string; baselineVersionId: string | null } | undefined;
    if (current?.lastVersionId === input.versionId) return current.baselineVersionId;
    const baseline = current?.lastVersionId ?? null;
    await database
      .prepare(
        `INSERT INTO handoff_seen_version (handoff_id, user_id, last_version_id, baseline_version_id, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (handoff_id, user_id) DO UPDATE SET last_version_id = EXCLUDED.last_version_id,
           baseline_version_id = EXCLUDED.baseline_version_id, updated_at = EXCLUDED.updated_at`,
      )
      .run(input.handoffId, input.userId, input.versionId, baseline, (input.now ?? new Date()).toISOString());
    return baseline;
  } catch (error) {
    if (isMissingSchema(error)) return null;
    throw error;
  }
}
