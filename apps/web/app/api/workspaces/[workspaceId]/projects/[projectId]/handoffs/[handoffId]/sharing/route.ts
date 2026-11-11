import { z } from "zod";
import { getHandoff, listHandoffInvites, setHandoffSharingMode } from "@/src/server/repositories/handoffs";
import { listWorkspaceMembers } from "@/src/server/repositories/projects";
import { requireWorkspaceRoleStrict, WorkspaceAccessError } from "@/src/server/workspace-access";

type SharingRoute = { params: Promise<{ workspaceId: string; projectId: string; handoffId: string }> };
const updateSharingSchema = z.object({
  mode: z.enum(["workspace", "invited", "anyone"]),
  revokePublicLink: z.boolean().optional(),
});

export async function GET(request: Request, context: SharingRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;
  try {
    await requireWorkspaceRoleStrict(request, workspaceId, ["owner", "designer"]);
    const handoff = getHandoff({ workspaceId, projectId, handoffId });
    if (!handoff) return Response.json({ error: "Handoff not found." }, { status: 404 });
    const origin = process.env.BETTER_AUTH_URL || new URL(request.url).origin;
    const reviewUrl = handoff.reviewShareId && handoff.publishedVersionId
      ? new URL(`/review/${encodeURIComponent(handoff.reviewShareId)}`, origin).toString()
      : null;
    return Response.json({
      mode: handoff.sharingMode,
      reviewUrl,
      publishedVersionId: handoff.publishedVersionId,
      invites: listHandoffInvites({ workspaceId, handoffId }),
      workspaceMembers: listWorkspaceMembers(workspaceId),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function PATCH(request: Request, context: SharingRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;
  try {
    await requireWorkspaceRoleStrict(request, workspaceId, ["owner", "designer"]);
    const parsed = updateSharingSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Choose a valid sharing mode." }, { status: 400 });
    if (parsed.data.revokePublicLink && parsed.data.mode !== "workspace") {
      return Response.json({ error: "Revoke the public link by switching to workspace access." }, { status: 400 });
    }
    const updated = setHandoffSharingMode({
      workspaceId,
      projectId,
      handoffId,
      mode: parsed.data.mode,
      revokePublicLink: parsed.data.revokePublicLink,
    });
    if (!updated) {
      return Response.json(
        { error: parsed.data.revokePublicLink ? "This public link is no longer active." : "Handoff not found." },
        { status: parsed.data.revokePublicLink ? 409 : 404 },
      );
    }
    if (parsed.data.revokePublicLink) {
      const handoff = getHandoff({ workspaceId, projectId, handoffId });
      if (!handoff?.reviewShareId) return Response.json({ error: "Handoff not found." }, { status: 404 });
      const origin = process.env.BETTER_AUTH_URL || new URL(request.url).origin;
      const reviewUrl = new URL(`/review/${encodeURIComponent(handoff.reviewShareId)}`, origin).toString();
      return Response.json({
        mode: "workspace",
        reviewUrl,
        invites: listHandoffInvites({ workspaceId, handoffId }),
      }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ mode: parsed.data.mode }, { status: 200 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
