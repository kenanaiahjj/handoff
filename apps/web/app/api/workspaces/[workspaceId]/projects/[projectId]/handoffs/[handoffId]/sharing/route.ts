import { z } from "zod";
import { getHandoff, listHandoffInvites, setHandoffSharingMode } from "@/src/server/repositories/handoffs";
import { listWorkspaceMembers } from "@/src/server/repositories/projects";
import { requireWorkspaceRoleStrict, WorkspaceAccessError } from "@/src/server/workspace-access";

type SharingRoute = { params: Promise<{ workspaceId: string; projectId: string; handoffId: string }> };
const sharingModeSchema = z.object({ mode: z.enum(["workspace", "invited", "anyone"]) });

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
    const parsed = sharingModeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Choose a valid sharing mode." }, { status: 400 });
    const updated = setHandoffSharingMode({ workspaceId, projectId, handoffId, mode: parsed.data.mode });
    if (!updated) return Response.json({ error: "Handoff not found." }, { status: 404 });
    return Response.json({ mode: parsed.data.mode }, { status: 200 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
