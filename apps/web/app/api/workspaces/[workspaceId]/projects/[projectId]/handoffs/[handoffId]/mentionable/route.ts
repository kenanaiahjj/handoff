import { listMentionables } from "@/src/server/services/mentions";
import { requireHandoffAccess, WorkspaceAccessError } from "@/src/server/workspace-access";

type MentionableRoute = { params: Promise<{ workspaceId: string; projectId: string; handoffId: string }> };

/** People who can be @mentioned on this handoff: team members who can open it. */
export async function GET(request: Request, context: MentionableRoute) {
  const { workspaceId, handoffId } = await context.params;
  try {
    const access = await requireHandoffAccess(request, { workspaceId, handoffId });
    const people = (await listMentionables(workspaceId, handoffId)).filter((person) => person.id !== access.userId);
    return Response.json({ people }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
