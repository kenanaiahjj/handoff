import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createHandoffInvite, getHandoff, listHandoffInvites } from "@/src/server/repositories/handoffs";
import { requireWorkspaceRoleStrict, WorkspaceAccessError } from "@/src/server/workspace-access";

type InvitesRoute = { params: Promise<{ workspaceId: string; projectId: string; handoffId: string }> };
const inviteSchema = z.object({
  email: z.string().trim().email().max(320),
  expiresInDays: z.union([
    z.number().int().refine((days) => [1, 7, 15, 30, 90, 365].includes(days)),
    z.null(),
  ]).default(7),
});

export async function GET(request: Request, context: InvitesRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;
  try {
    await requireWorkspaceRoleStrict(request, workspaceId, ["owner", "designer"]);
    if (!getHandoff({ workspaceId, projectId, handoffId })) {
      return Response.json({ error: "Handoff not found." }, { status: 404 });
    }
    return Response.json({ invites: listHandoffInvites({ workspaceId, handoffId }) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(request: Request, context: InvitesRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;
  try {
    const access = await requireWorkspaceRoleStrict(request, workspaceId, ["owner", "designer"]);
    const parsed = inviteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Enter a valid work email and expiry." }, { status: 400 });

    const now = new Date();
    const expiresAt = parsed.data.expiresInDays === null
      ? null
      : new Date(now.getTime() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    const token = randomBytes(32).toString("base64url");
    const invite = createHandoffInvite({
      workspaceId,
      projectId,
      handoffId,
      email: parsed.data.email,
      token,
      expiresAt,
      invitedByUserId: access.userId,
      createdAt: now.toISOString(),
    });
    if (!invite) {
      return Response.json({ error: "Publish this handoff and choose Only invited before adding recipients." }, { status: 409 });
    }

    const origin = process.env.BETTER_AUTH_URL || new URL(request.url).origin;
    const inviteUrl = new URL(`/review/${encodeURIComponent(invite.reviewShareId)}?invite=${encodeURIComponent(token)}`, origin).toString();
    return Response.json({ invite: { ...invite, inviteUrl } }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
