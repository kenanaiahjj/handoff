import { getProject } from "@/src/server/repositories/projects";
import { deleteProjectIcon, getProjectIcon, ProjectIconError, projectIconMaxBytes, setProjectIcon } from "@/src/server/services/project-icons";
import { managerRoles, requireWorkspaceRole, WorkspaceAccessError, workspaceRoles } from "@/src/server/workspace-access";

type ProjectIconRoute = { params: Promise<{ workspaceId: string; projectId: string }> };

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ProjectIconError) return Response.json({ error: error.message }, { status: 400 });
  throw error;
}

/** The project's icon. Anyone on the team can see it (project names are visible to them too). */
export async function GET(request: Request, context: ProjectIconRoute) {
  const { workspaceId, projectId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    if (!getProject({ workspaceId, projectId })) return Response.json({ error: "Not found." }, { status: 404 });
    const icon = getProjectIcon(projectId);
    if (!icon) return Response.json({ error: "Not found." }, { status: 404 });
    const etag = `"${icon.sha256.slice(0, 32)}"`;
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
    // The URL carries ?v=<fingerprint>, so a changed icon gets a new URL.
    return new Response(new Uint8Array(icon.bytes), {
      headers: {
        "Content-Type": icon.contentType,
        "Cache-Control": "private, max-age=31536000, immutable",
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Owners and designers upload an icon: the raw image bytes as the request body. */
export async function PUT(request: Request, context: ProjectIconRoute) {
  const { workspaceId, projectId } = await context.params;
  try {
    const access = await requireWorkspaceRole(request, workspaceId, managerRoles);
    if (!getProject({ workspaceId, projectId })) return Response.json({ error: "Not found." }, { status: 404 });
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > projectIconMaxBytes) return Response.json({ error: "Images can be up to 512 KB." }, { status: 413 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    return Response.json(setProjectIcon({ projectId, bytes, userId: access.userId }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: ProjectIconRoute) {
  const { workspaceId, projectId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, managerRoles);
    if (!getProject({ workspaceId, projectId })) return Response.json({ error: "Not found." }, { status: 404 });
    deleteProjectIcon(projectId);
    return Response.json({ iconVersion: null });
  } catch (error) {
    return errorResponse(error);
  }
}
