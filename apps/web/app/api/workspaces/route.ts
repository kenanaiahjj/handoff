import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDatabase } from "@/src/server/db";
import { getSessionForRequest } from "@/src/server/workspace-access";

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export async function GET(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });

  const workspaces = getDatabase()
    .prepare(
      `SELECT workspace.id, workspace.name, workspace.created_at AS createdAt,
              workspace_membership.role
       FROM workspace
       JOIN workspace_membership ON workspace_membership.workspace_id = workspace.id
       WHERE workspace_membership.user_id = ?
       ORDER BY workspace.created_at DESC`,
    )
    .all(session.user.id);

  return Response.json({ workspaces });
}

export async function POST(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });

  const parsed = createWorkspaceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Enter a workspace name under 80 characters." }, { status: 400 });
  }

  const database = getDatabase();
  const workspace = {
    id: randomUUID(),
    name: parsed.data.name,
    role: "owner" as const,
  };
  const createdAt = new Date().toISOString();

  const createWorkspace = database.transaction(() => {
    database
      .prepare(
        "INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(workspace.id, workspace.name, session.user.id, createdAt);
    database
      .prepare(
        "INSERT INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(workspace.id, session.user.id, "owner", createdAt);
  });

  createWorkspace();
  return Response.json({ workspace }, { status: 201 });
}
