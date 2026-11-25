import { z } from "zod";
import { getFinalizedCaptureSession } from "@/src/server/repositories/capture-sessions";
import { managerRoles, requireWorkspaceRole, WorkspaceAccessError } from "@/src/server/workspace-access";

const statusSchema = z.object({
  workspaceId: z.string().uuid(),
  token: z.string().min(1).max(200),
});

/**
 * Whether the Figma plugin has finished a capture started from the web form, so the form can show
 * "version ready" without a reload. The token travels in the body, never the URL, and only the
 * person who created the capture gets an answer.
 */
export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Send the workspace and capture token." }, { status: 400 }); }
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Send the workspace and capture token." }, { status: 400 });
  try {
    const access = await requireWorkspaceRole(request, parsed.data.workspaceId, managerRoles);
    const finalized = await getFinalizedCaptureSession(parsed.data.token);
    if (!finalized || finalized.workspaceId !== parsed.data.workspaceId || finalized.createdBy !== access.userId) {
      return Response.json({ status: "waiting" }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(
      { status: "ready", handoffId: finalized.handoffId, versionId: finalized.versionId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
