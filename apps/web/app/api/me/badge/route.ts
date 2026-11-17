import { getDatabase } from "@/src/server/db";
import { getCompanyWorkspace } from "@/src/server/services/company-workspace";
import { listOpenMentions } from "@/src/server/services/mentions";
import { listViewerUpdates } from "@/src/server/services/review-visibility";
import { getSessionForRequest } from "@/src/server/workspace-access";

/** The number for the installed app's icon: handoffs with a new version plus mentions waiting on you. */
export async function GET(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ count: 0 }, { headers: { "Cache-Control": "no-store" } });
  const company = (await getCompanyWorkspace());
  const membership = company
    ? ((await getDatabase().prepare("SELECT role FROM workspace_membership WHERE workspace_id = ? AND user_id = ?").get(company.id, session.user.id)) as { role: string } | undefined)
    : undefined;
  if (!company || !membership) return Response.json({ count: 0 }, { headers: { "Cache-Control": "no-store" } });
  const viewer = { id: session.user.id, email: session.user.email, role: membership.role };
  const count = (await listViewerUpdates(company.id, viewer)).length + (await listOpenMentions(session.user.id, company.id, viewer)).length;
  return Response.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
