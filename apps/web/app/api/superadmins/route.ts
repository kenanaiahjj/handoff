import { z } from "zod";
import { addSuperadmin, isSuperadmin, listSuperadmins, removeSuperadmin } from "@/src/server/services/superadmins";
import { getSessionForRequest } from "@/src/server/workspace-access";

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

/** Only super admins can see or change the super admin list. */
async function requireSuperadmin(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return { error: Response.json({ error: "Sign in to continue." }, { status: 401 }) };
  if (!isSuperadmin(session.user.email)) return { error: Response.json({ error: "Only super admins can do this." }, { status: 403 }) };
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
    return Response.json({ error: "You can't remove yourself. Ask another super admin." }, { status: 400 });
  }
  if (!removeSuperadmin(parsed.data.email)) return Response.json({ error: "That person isn't a super admin." }, { status: 404 });
  return Response.json({ superadmins: listSuperadmins() });
}
