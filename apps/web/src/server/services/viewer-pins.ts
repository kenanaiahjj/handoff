import { getDatabase } from "../db";

export type PinKind = "workspace" | "project";

/** "workspace:<id>" or "project:<id>", oldest pin first. */
export function listPinKeys(userId: string) {
  return (
    getDatabase()
      .prepare("SELECT kind, target_id AS targetId FROM viewer_pin WHERE user_id = ? ORDER BY created_at ASC")
      .all(userId) as Array<{ kind: PinKind; targetId: string }>
  ).map((pin) => `${pin.kind}:${pin.targetId}`);
}

/** Only things this person can open may be pinned: a workspace they belong to, or a project in one. */
export function canPin(userId: string, kind: PinKind, targetId: string) {
  const database = getDatabase();
  if (kind === "workspace") {
    return Boolean(database.prepare("SELECT 1 FROM workspace_membership WHERE workspace_id = ? AND user_id = ?").get(targetId, userId));
  }
  return Boolean(
    database
      .prepare(
        `SELECT 1 FROM project JOIN workspace_membership ON workspace_membership.workspace_id = project.workspace_id
         WHERE project.id = ? AND workspace_membership.user_id = ?`,
      )
      .get(targetId, userId),
  );
}

export function setPinned(userId: string, kind: PinKind, targetId: string, pinned: boolean) {
  const database = getDatabase();
  if (pinned) {
    database
      .prepare("INSERT OR IGNORE INTO viewer_pin (user_id, kind, target_id, created_at) VALUES (?, ?, ?, ?)")
      .run(userId, kind, targetId, new Date().toISOString());
  } else {
    database.prepare("DELETE FROM viewer_pin WHERE user_id = ? AND kind = ? AND target_id = ?").run(userId, kind, targetId);
  }
}
