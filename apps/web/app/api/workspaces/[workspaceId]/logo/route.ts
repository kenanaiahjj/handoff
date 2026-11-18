import { requireWorkspaceRole, WorkspaceAccessError, workspaceRoles } from "@/src/server/workspace-access";
import { projectIconMaxBytes } from "@/src/server/services/project-icons";
import { deleteWorkspaceLogo, getWorkspaceLogo, setWorkspaceLogo, WorkspaceSettingsError } from "@/src/server/services/workspace-settings";

type LogoRoute = { params: Promise<{ workspaceId: string }> };

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof WorkspaceSettingsError) return Response.json({ error: error.message }, { status: 400 });
  throw error;
}

/** The workspace logo, for anyone in the workspace. The URL carries ?v=<fingerprint>. */
export async function GET(request: Request, context: LogoRoute) {
  const { workspaceId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const logo = await getWorkspaceLogo(workspaceId);
    if (!logo) return Response.json({ error: "Not found." }, { status: 404 });
    return new Response(new Uint8Array(logo.bytes), {
      headers: { "Content-Type": logo.contentType, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: LogoRoute) {
  const { workspaceId } = await context.params;
  try {
    const access = await requireWorkspaceRole(request, workspaceId, ["owner"]);
    if (Number(request.headers.get("content-length") ?? 0) > projectIconMaxBytes) return Response.json({ error: "Images can be up to 512 KB." }, { status: 413 });
    return Response.json(await setWorkspaceLogo(workspaceId, new Uint8Array(await request.arrayBuffer()), access.userId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: LogoRoute) {
  const { workspaceId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, ["owner"]);
    await deleteWorkspaceLogo(workspaceId);
    return Response.json({ logoVersion: null });
  } catch (error) {
    return errorResponse(error);
  }
}
