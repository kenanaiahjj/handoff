import { z } from "zod";
import { createCaptureSession } from "@/src/server/repositories/capture-sessions";
import { getHandoff } from "@/src/server/repositories/handoffs";
import { getDatabase } from "@/src/server/db";
import { requireWorkspaceRole, WorkspaceAccessError, workspaceRoles } from "@/src/server/workspace-access";

const sessionSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  handoffId: z.string().uuid().nullable().optional(),
  handoffName: z.string().trim().min(1).max(100).nullable().optional(),
  versionLabel: z.string().trim().min(1).max(80),
  releaseNote: z.string().trim().max(4000).nullable().optional(),
});

export async function POST(request: Request) {
  let access: Awaited<ReturnType<typeof requireWorkspaceRole>>;
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Enter the handoff and version details." }, { status: 400 }); }
  const parsed = sessionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Check the handoff name, version, and project." }, { status: 400 });
  try {
    access = await requireWorkspaceRole(request, parsed.data.workspaceId, [...workspaceRoles]);
    const project = getDatabase()
      .prepare("SELECT 1 FROM project WHERE id = ? AND workspace_id = ?")
      .get(parsed.data.projectId, parsed.data.workspaceId);
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    const handoffId = parsed.data.handoffId ?? null;
    if (handoffId && !getHandoff({ workspaceId: parsed.data.workspaceId, projectId: parsed.data.projectId, handoffId })) {
      return Response.json({ error: "Handoff not found in this project." }, { status: 404 });
    }
    const handoffName = handoffId ? null : parsed.data.handoffName?.trim() || null;
    if (!handoffId && !handoffName) return Response.json({ error: "Enter a handoff name for the first capture." }, { status: 400 });
    const session = createCaptureSession({
      workspaceId: parsed.data.workspaceId,
      projectId: parsed.data.projectId,
      handoffId,
      handoffName,
      versionLabel: parsed.data.versionLabel,
      releaseNote: parsed.data.releaseNote ?? null,
      createdBy: access.userId,
    });
    return Response.json(session, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
