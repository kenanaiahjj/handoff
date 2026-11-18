import { z } from "zod";
import { requireWorkspaceRole, WorkspaceAccessError } from "@/src/server/workspace-access";
import { getWorkspaceSettings, updateWorkspaceSettings, WorkspaceSettingsError } from "@/src/server/services/workspace-settings";

type SettingsRoute = { params: Promise<{ workspaceId: string }> };

const settingsSchema = z.object({
  name: z.string().max(200).optional(),
  allowedEmailDomains: z.array(z.string().max(260)).max(50).nullable().optional(),
});

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof WorkspaceSettingsError) return Response.json({ error: error.message }, { status: 400 });
  throw error;
}

export async function GET(request: Request, context: SettingsRoute) {
  const { workspaceId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, ["owner"]);
    return Response.json(await getWorkspaceSettings(workspaceId));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Owners rename the workspace and choose which email domains can sign up on their own. */
export async function PATCH(request: Request, context: SettingsRoute) {
  const { workspaceId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, ["owner"]);
    const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Check the settings and try again." }, { status: 400 });
    return Response.json(await updateWorkspaceSettings(workspaceId, parsed.data));
  } catch (error) {
    return errorResponse(error);
  }
}
