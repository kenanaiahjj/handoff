import { z } from "zod";
import { requireWorkspaceRole, WorkspaceAccessError } from "@/src/server/workspace-access";
import { getRoleFeatureSettings, updateRoleFeatureSettings } from "@/src/server/services/workspace-settings";
import { configurableRoles, roleFeatureKeys } from "@/src/lib/role-features";

type RoleFeaturesRoute = { params: Promise<{ workspaceId: string }> };

const flagsSchema = z.object(Object.fromEntries(roleFeatureKeys.map((feature) => [feature, z.boolean()])) as Record<(typeof roleFeatureKeys)[number], z.ZodBoolean>);
const settingsSchema = z.object(Object.fromEntries(configurableRoles.map((role) => [role, flagsSchema])) as Record<(typeof configurableRoles)[number], typeof flagsSchema>);

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
  throw error;
}

export async function GET(request: Request, context: RoleFeaturesRoute) {
  const { workspaceId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, ["owner"]);
    return Response.json(await getRoleFeatureSettings(workspaceId));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Owners choose which canvas features each role gets. */
export async function PUT(request: Request, context: RoleFeaturesRoute) {
  const { workspaceId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, ["owner"]);
    const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Check the feature settings and try again." }, { status: 400 });
    return Response.json(await updateRoleFeatureSettings(workspaceId, parsed.data));
  } catch (error) {
    return errorResponse(error);
  }
}
