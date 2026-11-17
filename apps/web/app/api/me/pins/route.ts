import { z } from "zod";
import { canPin, listPinKeys, setPinned } from "@/src/server/services/viewer-pins";
import { getSessionForRequest } from "@/src/server/workspace-access";

const pinSchema = z.object({
  kind: z.enum(["workspace", "project"]),
  targetId: z.string().min(1).max(100),
  pinned: z.boolean(),
});

/** Pins or unpins a workspace or project at the top of this person's home. */
export async function POST(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const parsed = pinSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose something to pin." }, { status: 400 });

  const { kind, targetId, pinned } = parsed.data;
  if (pinned && !(await canPin(session.user.id, kind, targetId))) return Response.json({ error: "Not found." }, { status: 404 });
  (await setPinned(session.user.id, kind, targetId, pinned));
  return Response.json({ pins: (await listPinKeys(session.user.id)) });
}
