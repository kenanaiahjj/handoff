import { getDatabase } from "@/src/server/db";
import { createHandoffVersion } from "@/src/server/repositories/versions";
import {
  importImageOnly,
  importSnapshotPackage,
  parseUploadForm,
  SnapshotImportError,
} from "@/src/server/services/import-snapshot";
import {
  requireProjectMember,
  WorkspaceAccessError,
} from "@/src/server/workspace-access";
import { z } from "zod";

type VersionRoute = RouteContext<"/api/workspaces/[workspaceId]/handoffs/[handoffId]/versions">;

const versionDetailsSchema = z.object({
  versionLabel: z.string().trim().min(1).max(80),
  releaseNote: z.string().trim().max(4000).nullable().optional(),
});

function textEntry(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

export async function POST(request: Request, context: VersionRoute) {
  const { workspaceId, handoffId } = await context.params;

  try {
    const handoff = getDatabase()
      .prepare(
        `SELECT project_id AS projectId
         FROM handoff WHERE id = ? AND workspace_id = ?`,
      )
      .get(handoffId, workspaceId) as { projectId: string } | undefined;
    if (!handoff) return Response.json({ error: "Handoff not found." }, { status: 404 });
    const access = await requireProjectMember(request, workspaceId, handoff.projectId);

    const form = await parseUploadForm(request);
    const parsedDetails = versionDetailsSchema.safeParse({
      versionLabel: textEntry(form, "versionLabel"),
      releaseNote: textEntry(form, "releaseNote") ?? null,
    });
    if (!parsedDetails.success) {
      return Response.json({ error: "Enter a version label and an optional short release note." }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new SnapshotImportError("Choose a ZIP package or a PNG, JPEG, WebP, or SVG render.", 400);
    }
    const imported = file.name.toLowerCase().endsWith(".zip")
      ? await importSnapshotPackage(new Uint8Array(await file.arrayBuffer()))
      : await importImageOnly(file);

    const created = await createHandoffVersion({
      workspaceId,
      projectId: handoff.projectId,
      handoffId,
      versionLabel: parsedDetails.data.versionLabel,
      releaseNote: parsedDetails.data.releaseNote,
      createdBy: access.userId,
      snapshot: imported.snapshot,
      assets: imported.assets,
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
      return Response.json({ error: "That version label already exists for this handoff." }, { status: 409 });
    }
    throw error;
  }
}
