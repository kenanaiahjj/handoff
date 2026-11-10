import { z } from "zod";
import { isStructuredSnapshot } from "@/src/server/services/diff";
import { createHandoffAnnotation, listHandoffAnnotations } from "@/src/server/repositories/annotations";
import { getVersion } from "@/src/server/repositories/versions";
import { canvasAnnotationAnchorError } from "@/src/server/services/canvas-annotation-anchor";
import { requireProjectMember, requireWorkspaceRole, WorkspaceAccessError, workspaceRoles } from "@/src/server/workspace-access";

type AnnotationsRoute = RouteContext<"/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/versions/[versionId]/annotations">;

const createSchema = z.object({
  frameId: z.string().min(1).max(200),
  sourceNodeId: z.string().min(1).max(200).nullable(),
  x: z.number().finite().min(0),
  y: z.number().finite().min(0),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
});

function belongsToHandoff(input: { workspaceId: string; handoffId: string; versionId: string }) {
  const version = getVersion({ workspaceId: input.workspaceId, versionId: input.versionId });
  return version?.handoffId === input.handoffId ? version : null;
}

export async function GET(request: Request, context: AnnotationsRoute) {
  const { workspaceId, handoffId, versionId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    if (!belongsToHandoff({ workspaceId, handoffId, versionId })) {
      return Response.json({ error: "Handoff version not found." }, { status: 404 });
    }
    return Response.json({ annotations: listHandoffAnnotations({ workspaceId, versionId }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function POST(request: Request, context: AnnotationsRoute) {
  const { workspaceId, projectId, handoffId, versionId } = await context.params;
  try {
    const access = await requireProjectMember(request, workspaceId, projectId);
    const version = belongsToHandoff({ workspaceId, handoffId, versionId });
    if (!version) return Response.json({ error: "Handoff version not found." }, { status: 404 });
    if (!isStructuredSnapshot(version.snapshot)) {
      return Response.json({ error: "Canvas annotations need a structured Figma capture." }, { status: 400 });
    }
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Enter a title and note, then choose a canvas point." }, { status: 400 });
    const anchorError = canvasAnnotationAnchorError(version.snapshot, parsed.data);
    if (anchorError) return Response.json({ error: anchorError }, { status: 400 });
    const annotation = createHandoffAnnotation({
      workspaceId,
      versionId,
      frameId: parsed.data.frameId,
      sourceNodeId: parsed.data.sourceNodeId,
      x: parsed.data.x,
      y: parsed.data.y,
      title: parsed.data.title,
      body: parsed.data.body,
      createdBy: access.userId,
    });
    return Response.json({ annotation }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
