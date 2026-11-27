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
  /** The part of the canvas they can see, in Figma page units (null from older clients). */
  view: CanvasView | null;
  /** Whose view they're following, if anyone's. */
  following: string | null;
};

export type CanvasView = { x: number; y: number; width: number; height: number };

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
  view?: CanvasView | null;
  following?: string | null;
  now?: Date;
}): Promise<CanvasViewer[]> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - presenceWindowMs).toISOString();
  const database = getDatabase();
  const view = input.view ?? null;
  try {
    if (!(await hasFollowColumns())) return await legacyHeartbeat(input, now, since);
    await database
      .prepare(
        `INSERT INTO canvas_presence (handoff_id, user_id, version_id, screen_id, pointer_x, pointer_y,
           view_x, view_y, view_width, view_height, following_user_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (handoff_id, user_id) DO UPDATE SET version_id = EXCLUDED.version_id, screen_id = EXCLUDED.screen_id,
           pointer_x = EXCLUDED.pointer_x, pointer_y = EXCLUDED.pointer_y, view_x = EXCLUDED.view_x, view_y = EXCLUDED.view_y,
           view_width = EXCLUDED.view_width, view_height = EXCLUDED.view_height,
           following_user_id = EXCLUDED.following_user_id, updated_at = EXCLUDED.updated_at`,
      )
      .run(input.handoffId, input.userId, input.versionId, input.screenId, input.x, input.y,
        view?.x ?? null, view?.y ?? null, view?.width ?? null, view?.height ?? null, input.following ?? null, now.toISOString());
    const rows = (await database
      .prepare(
        `SELECT presence.user_id AS "userId", COALESCE("user".name, '') AS name, "user".image AS image,
                presence.version_id AS "versionId", presence.screen_id AS "screenId",
                presence.pointer_x AS x, presence.pointer_y AS y,
                presence.view_x AS "viewX", presence.view_y AS "viewY",
                presence.view_width AS "viewWidth", presence.view_height AS "viewHeight",
                presence.following_user_id AS following
         FROM canvas_presence AS presence
         JOIN "user" ON "user".id = presence.user_id
         WHERE presence.handoff_id = ? AND presence.user_id <> ? AND presence.updated_at > ?
         ORDER BY "user".name LIMIT 30`,
      )
      .all(input.handoffId, input.userId, since)) as Array<Omit<CanvasViewer, "view"> & { viewX: number | null; viewY: number | null; viewWidth: number | null; viewHeight: number | null }>;
    return rows.map(({ viewX, viewY, viewWidth, viewHeight, ...row }) => ({
      ...row,
      x: toNumber(row.x),
      y: toNumber(row.y),
      view: viewX === null || viewY === null || viewWidth === null || viewHeight === null
        ? null
        : { x: Number(viewX), y: Number(viewY), width: Number(viewWidth), height: Number(viewHeight) },
      following: row.following ?? null,
    }));
  } catch (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
}

function toNumber(value: number | null) {
  return value === null ? null : Number(value);
}

// Until the follow migration is applied, presence keeps working without views. Checked once, and
// again a minute later while the columns are still missing.
let followColumns: { present: boolean; checkedAt: number } | null = null;

/** Forget the answer, e.g. right after applying migrations in a test. */
export function recheckPresenceColumns() {
  followColumns = null;
}
async function hasFollowColumns() {
  if (followColumns && (followColumns.present || Date.now() - followColumns.checkedAt < 60_000)) return followColumns.present;
  const row = await getDatabase()
    .prepare(`SELECT 1 AS present FROM information_schema.columns WHERE table_name = 'canvas_presence' AND column_name = 'following_user_id'`)
    .get();
  followColumns = { present: Boolean(row), checkedAt: Date.now() };
  return followColumns.present;
}

async function legacyHeartbeat(
  input: { handoffId: string; userId: string; versionId: string; screenId: string | null; x: number | null; y: number | null },
  now: Date,
  since: string,
): Promise<CanvasViewer[]> {
  const database = getDatabase();
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
    .all(input.handoffId, input.userId, since)) as Array<Omit<CanvasViewer, "view" | "following">>;
  return rows.map((row) => ({ ...row, x: toNumber(row.x), y: toNumber(row.y), view: null, following: null }));
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
