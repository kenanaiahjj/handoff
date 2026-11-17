import { getDatabase } from "../db";

export type PinKind = "workspace" | "project";

/** "workspace:<id>" or "project:<id>", oldest pin first. */
export async function listPinKeys(userId: string) {
  return (
    (await getDatabase()
      .prepare("SELECT kind, target_id AS targetId FROM viewer_pin WHERE user_id = ? ORDER BY created_at ASC")
      .all(userId)) as Array<{ kind: PinKind; targetId: string }>
  ).map((pin) => `${pin.kind}:${pin.targetId}`);
}

/** Only things this person can open may be pinned: a workspace they belong to, or a project in one. */
export async function canPin(userId: string, kind: PinKind, targetId: string) {
  const database = getDatabase();
  if (kind === "workspace") {
    return Boolean((await database.prepare("SELECT 1 FROM workspace_membership WHERE workspace_id = ? AND user_id = ?").get(targetId, userId)));
  }
  return Boolean(
    (await database
      .prepare(
        `SELECT 1 FROM project JOIN workspace_membership ON workspace_membership.workspace_id = project.workspace_id
         WHERE project.id = ? AND workspace_membership.user_id = ?`,
      )
      .get(targetId, userId)),
  );
}

export async function setPinned(userId: string, kind: PinKind, targetId: string, pinned: boolean) {
  const database = getDatabase();
  if (pinned) {
    (await database
      .prepare("INSERT INTO viewer_pin (user_id, kind, target_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
      .run(userId, kind, targetId, new Date().toISOString()));
  } else {
    (await database.prepare("DELETE FROM viewer_pin WHERE user_id = ? AND kind = ? AND target_id = ?").run(userId, kind, targetId));
  }
}
