import { z } from "zod";
import { markHandoffsSeenForViewer } from "@/src/server/services/review-visibility";
import { getSessionForRequest } from "@/src/server/workspace-access";

const seenSchema = z.object({ handoffIds: z.array(z.string().min(1).max(100)).min(1).max(500) });

/** Clears "New version" for these handoffs without opening each one. */
export async function POST(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const parsed = seenSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose handoffs to mark as seen." }, { status: 400 });
  const marked = (await markHandoffsSeenForViewer(session.user, [...new Set(parsed.data.handoffIds)]));
  return Response.json({ marked });
}
