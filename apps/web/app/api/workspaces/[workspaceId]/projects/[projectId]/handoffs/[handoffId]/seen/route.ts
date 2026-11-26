import { z } from "zod";
import { markHandoffVersionSeen } from "@/src/server/repositories/canvas-presence";
import { requireHandoffAccess, WorkspaceAccessError } from "@/src/server/workspace-access";

type SeenRoute = { params: Promise<{ workspaceId: string; projectId: string; handoffId: string }> };

/** Notes the version you opened; returns the one you had open last time, to show what changed since. */
export async function POST(request: Request, context: SeenRoute) {
  const { workspaceId, handoffId } = await context.params;
  try {
    const access = await requireHandoffAccess(request, { workspaceId, handoffId });
    const parsed = z.object({ versionId: z.string().min(1).max(100) }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Choose a version." }, { status: 400 });
    const baselineVersionId = await markHandoffVersionSeen({ handoffId, userId: access.userId, versionId: parsed.data.versionId });
    return Response.json({ baselineVersionId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
