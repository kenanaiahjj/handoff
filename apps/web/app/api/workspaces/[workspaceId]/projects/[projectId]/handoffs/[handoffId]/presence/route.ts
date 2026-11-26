import { z } from "zod";
import { heartbeatCanvasPresence, leaveCanvasPresence } from "@/src/server/repositories/canvas-presence";
import { requireHandoffAccess, WorkspaceAccessError } from "@/src/server/workspace-access";

type PresenceRoute = { params: Promise<{ workspaceId: string; projectId: string; handoffId: string }> };

const coordinate = z.number().finite().min(-1e7).max(1e7).nullable();
const heartbeatSchema = z.object({
  versionId: z.string().min(1).max(100),
  screenId: z.string().min(1).max(256).nullable(),
  x: coordinate,
  y: coordinate,
  leaving: z.boolean().optional(),
});

/** Live presence: send where you are on the canvas, get back who else has this handoff open. */
export async function POST(request: Request, context: PresenceRoute) {
  const { workspaceId, handoffId } = await context.params;
  try {
    const access = await requireHandoffAccess(request, { workspaceId, handoffId });
    // sendBeacon posts text/plain, so read the body as text.
    const parsed = heartbeatSchema.safeParse(await request.text().then((body) => JSON.parse(body)).catch(() => null));
    if (!parsed.success) return Response.json({ error: "Invalid presence update." }, { status: 400 });
    if (parsed.data.leaving) {
      await leaveCanvasPresence(handoffId, access.userId);
      return Response.json({ viewers: [] });
    }
    const viewers = await heartbeatCanvasPresence({ handoffId, userId: access.userId, ...parsed.data });
    return Response.json({ viewers }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
