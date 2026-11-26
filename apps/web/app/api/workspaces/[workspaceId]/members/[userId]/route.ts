import { z } from "zod";
import { changeMemberRole, declineDesignerRequest, listMembers, MemberChangeError, removeMember } from "@/src/server/services/members";
import { inviteRoles } from "@/src/lib/team-roles";
import { requireWorkspaceRole, WorkspaceAccessError, workspaceRoles } from "@/src/server/workspace-access";

type MemberRoute = { params: Promise<{ workspaceId: string; userId: string }> };

const updateSchema = z.union([
  z.object({ jobRole: z.enum(inviteRoles) }),
  z.object({ role: z.enum(workspaceRoles) }),
  z.object({ request: z.literal("decline") }),
]);

function failure(error: unknown) {
  if (error instanceof WorkspaceAccessError || error instanceof MemberChangeError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  throw error;
}

/** Owners change someone's role, or decline a designer request. */
export async function PATCH(request: Request, context: MemberRoute) {
  const { workspaceId, userId } = await context.params;
  try {
    const actor = await requireWorkspaceRole(request, workspaceId, ["owner"]);
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Choose a role." }, { status: 400 });
    if ("jobRole" in parsed.data) (await changeMemberRole({ workspaceId, actorId: actor.userId, userId, jobRole: parsed.data.jobRole }));
    else if ("role" in parsed.data) (await changeMemberRole({ workspaceId, actorId: actor.userId, userId, role: parsed.data.role }));
    else (await declineDesignerRequest({ workspaceId, actorId: actor.userId, userId }));
    return Response.json({ members: (await listMembers(workspaceId)) });
  } catch (error) {
    return failure(error);
  }
}

/** Owners remove someone from the team. */
export async function DELETE(request: Request, context: MemberRoute) {
  const { workspaceId, userId } = await context.params;
  try {
    const actor = await requireWorkspaceRole(request, workspaceId, ["owner"]);
    (await removeMember({ workspaceId, actorId: actor.userId, userId }));
    return Response.json({ members: (await listMembers(workspaceId)) });
  } catch (error) {
    return failure(error);
  }
}
