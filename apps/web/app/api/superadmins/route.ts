import { z } from "zod";
import { addSuperadmin, isSuperadmin, listSuperadmins, removeSuperadmin } from "@/src/server/services/superadmins";
import { getDatabase } from "@/src/server/db";
import { getCompanyWorkspace } from "@/src/server/services/company-workspace";
import { getSessionForRequest } from "@/src/server/workspace-access";

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

/**
 * Owners added by email: any owner can see or change the list. (These used to be called "Admins";
 * they are owners who may sign in from outside the company domains.)
 */
async function requireSuperadmin(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return { error: Response.json({ error: "Sign in to continue." }, { status: 401 }) };
  const company = getCompanyWorkspace();
  const role = company
    ? (getDatabase().prepare("SELECT role FROM workspace_membership WHERE workspace_id = ? AND user_id = ?").get(company.id, session.user.id) as { role: string } | undefined)?.role
    : undefined;
  if (role !== "owner" && !isSuperadmin(session.user.email)) return { error: Response.json({ error: "Only owners can do this." }, { status: 403 }) };
  return { session };
}

export async function GET(request: Request) {
  const { error } = await requireSuperadmin(request);
  if (error) return error;
  return Response.json({ superadmins: listSuperadmins() });
}

export async function POST(request: Request) {
  const { session, error } = await requireSuperadmin(request);
  if (error) return error;
  const parsed = emailSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  addSuperadmin(parsed.data.email, session.user.id);
  return Response.json({ superadmins: listSuperadmins() }, { status: 201 });
}

export async function DELETE(request: Request) {
  const { session, error } = await requireSuperadmin(request);
  if (error) return error;
  const parsed = emailSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  if (parsed.data.email === session.user.email.toLowerCase()) {
    return Response.json({ error: "You can't remove yourself. Ask another owner." }, { status: 400 });
  }
  if (!removeSuperadmin(parsed.data.email)) return Response.json({ error: "That invitation no longer exists." }, { status: 404 });
  return Response.json({ superadmins: listSuperadmins() });
}
