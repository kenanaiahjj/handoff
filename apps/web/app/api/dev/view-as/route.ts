import { z } from "zod";
import { isDevelopmentAuthBypassEnabled, localReviewerUser, viewAsCookieName } from "@/src/server/auth-session";
import { getDatabase } from "@/src/server/db";

const bodySchema = z.object({
  mode: z.enum(["owner", "reviewer"]),
  workspaceId: z.string().min(1),
});

/**
 * Development only: switches the auth-bypass session between the first local account and a
 * seeded reviewer, so both views can be checked without real sign-in. Disabled in production.
 */
export async function POST(request: Request) {
  if (!isDevelopmentAuthBypassEnabled()) return Response.json({ error: "Not found." }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose a view and workspace." }, { status: 400 });
  const { mode, workspaceId } = parsed.data;
  const database = getDatabase();
  const workspace = database.prepare("SELECT id FROM workspace WHERE id = ?").get(workspaceId);
  if (!workspace) return Response.json({ error: "Workspace not found." }, { status: 404 });

  const headers = new Headers({ "Content-Type": "application/json" });
  if (mode === "owner") {
    headers.append("Set-Cookie", `${viewAsCookieName}=; Path=/; Max-Age=0; SameSite=Lax`);
    return new Response(JSON.stringify({ mode }), { headers });
  }

  const now = new Date().toISOString();
  database
    .prepare('INSERT OR IGNORE INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 0, NULL, ?, ?)')
    .run(localReviewerUser.id, localReviewerUser.name, localReviewerUser.email, now, now);
  database
    .prepare(
      `INSERT INTO workspace_membership (workspace_id, user_id, role, created_at)
       SELECT ?, ?, 'reviewer', ?
       WHERE NOT EXISTS (SELECT 1 FROM workspace_membership WHERE workspace_id = ? AND user_id = ?)`,
    )
    .run(workspaceId, localReviewerUser.id, now, workspaceId, localReviewerUser.id);
  headers.append("Set-Cookie", `${viewAsCookieName}=${encodeURIComponent(localReviewerUser.id)}; Path=/; HttpOnly; SameSite=Lax`);
  return new Response(JSON.stringify({ mode }), { headers });
}
