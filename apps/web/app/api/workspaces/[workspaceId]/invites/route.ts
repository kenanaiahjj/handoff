import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  requireWorkspaceRole,
  WorkspaceAccessError,
  workspaceRoles,
} from "@/src/server/workspace-access";
import { getDatabase } from "@/src/server/db";

const createInviteSchema = z.object({
  role: z.enum(workspaceRoles),
  expiresInDays: z.union([
    z.number().int().refine((days) => [1, 7, 15, 30, 90, 365].includes(days)),
    z.null(),
  ]).default(7),
});

export async function GET(
  request: Request,
  context: RouteContext<"/api/workspaces/[workspaceId]/invites">,
) {
  const { workspaceId } = await context.params;

  try {
    const access = await requireWorkspaceRole(request, workspaceId, ["owner"]);
    const invites = getDatabase()
      .prepare(
        `SELECT id, role, expires_at AS expiresAt, created_at AS createdAt
         FROM workspace_invite
         WHERE workspace_id = ? AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC`,
      )
      .all(access.workspaceId, new Date().toISOString());
    return Response.json({ invites });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/workspaces/[workspaceId]/invites">,
) {
  const { workspaceId } = await context.params;

  try {
    const access = await requireWorkspaceRole(request, workspaceId, ["owner"]);
    const parsed = createInviteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "Choose a role and one of the available expiry periods." }, { status: 400 });
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const createdAt = new Date();
    const expiresAt = parsed.data.expiresInDays === null
      ? null
      : new Date(createdAt.getTime() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    const inviteId = randomUUID();

    getDatabase()
      .prepare(
        `INSERT INTO workspace_invite
          (id, workspace_id, invited_by_user_id, token_hash, role, expires_at, reusable, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        inviteId,
        access.workspaceId,
        access.userId,
        tokenHash,
        parsed.data.role,
        expiresAt,
        createdAt.toISOString(),
      );

    const inviteUrl = new URL(`/invite/${token}`, request.url).toString();
    return Response.json({
      inviteUrl,
      invite: { id: inviteId, role: parsed.data.role, expiresAt, createdAt: createdAt.toISOString() },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
