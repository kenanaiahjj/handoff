import { z } from "zod";
import { getSlackPreference, setSlackPreference, slackPreferences } from "@/src/server/services/notification-preferences";
import { getSessionForRequest } from "@/src/server/workspace-access";

/** This person's notification settings. */
export async function GET(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  return Response.json({ slack: (await getSlackPreference(session.user.id)) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const parsed = z.object({ slack: z.enum(slackPreferences) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose all, mentions or off." }, { status: 400 });
  (await setSlackPreference(session.user.id, parsed.data.slack));
  return Response.json({ slack: parsed.data.slack });
}
