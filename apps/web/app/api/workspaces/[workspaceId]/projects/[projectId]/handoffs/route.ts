import { z } from "zod";
import { getDatabase } from "@/src/server/db";
import { listHandoffs } from "@/src/server/repositories/handoffs";
import { createHandoffVersion } from "@/src/server/repositories/versions";
import {
  importImageOnly,
  importSnapshotPackage,
  parseUploadForm,
  SnapshotImportError,
} from "@/src/server/services/import-snapshot";
import {
  requireProjectMember,
  requireWorkspaceRole,
  WorkspaceAccessError,
  workspaceRoles,
} from "@/src/server/workspace-access";

type HandoffRoute = RouteContext<"/api/workspaces/[workspaceId]/projects/[projectId]/handoffs">;

const versionDetailsSchema = z.object({
  handoffName: z.string().trim().min(1).max(100),
  versionLabel: z.string().trim().min(1).max(80),
  releaseNote: z.string().trim().max(4000).nullable().optional(),
});

function textEntry(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

async function parseVersionUpload(request: Request) {
  const form = await parseUploadForm(request);
  const parsedDetails = versionDetailsSchema.safeParse({
    handoffName: textEntry(form, "handoffName"),
    versionLabel: textEntry(form, "versionLabel"),
    releaseNote: textEntry(form, "releaseNote") ?? null,
  });

  if (!parsedDetails.success) {
    throw new SnapshotImportError("Enter a handoff name, a version label, and an optional short release note.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new SnapshotImportError("Choose a ZIP package or a PNG, JPEG, WebP, or SVG render.", 400);
  }

  const imported = file.name.toLowerCase().endsWith(".zip")
    ? await importSnapshotPackage(new Uint8Array(await file.arrayBuffer()))
    : await importImageOnly(file);

  return { ...parsedDetails.data, ...imported };
}

export async function GET(request: Request, context: HandoffRoute) {
  const { workspaceId, projectId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const project = getDatabase()
      .prepare("SELECT 1 FROM project WHERE id = ? AND workspace_id = ?")
      .get(projectId, workspaceId);
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    return Response.json({ handoffs: listHandoffs({ workspaceId, projectId }) });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(request: Request, context: HandoffRoute) {
  const { workspaceId, projectId } = await context.params;

  try {
    const access = await requireProjectMember(request, workspaceId, projectId);
    const project = getDatabase()
      .prepare("SELECT 1 FROM project WHERE id = ? AND workspace_id = ?")
      .get(projectId, workspaceId);
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });

    const upload = await parseVersionUpload(request);
    const created = await createHandoffVersion({
      workspaceId,
      projectId,
      handoffName: upload.handoffName,
      versionLabel: upload.versionLabel,
      releaseNote: upload.releaseNote,
      createdBy: access.userId,
      snapshot: upload.snapshot,
      assets: upload.assets,
    });

    return Response.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SnapshotImportError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return Response.json({ error: "A handoff with that name and version already exists." }, { status: 409 });
    }
    throw error;
  }
}
