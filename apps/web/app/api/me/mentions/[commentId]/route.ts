import { markMentionDone } from "@/src/server/services/mentions";
import { getSessionForRequest } from "@/src/server/workspace-access";

type MentionRoute = { params: Promise<{ commentId: string }> };

/** Clears a mention from "Needs you". */
export async function DELETE(request: Request, context: MentionRoute) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const { commentId } = await context.params;
  return Response.json({ done: markMentionDone(session.user.id, commentId) });
}
