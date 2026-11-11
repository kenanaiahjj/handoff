import { z } from "zod";
import { createEvidenceLinkedDraft } from "@/src/server/ai/draft-changelog";
import { isAiConfigured } from "@/src/server/ai/openai-provider";
import { createChangelogDraft, listChangelogDrafts } from "@/src/server/repositories/changelogs";
import { getHandoff, listHandoffVersions } from "@/src/server/repositories/handoffs";
import { getProject } from "@/src/server/repositories/projects";
import {
  getConfirmedFrameMatchesBetweenVersions,
  getConfirmedNodeMatchesBetweenVersions,
  getVersion,
} from "@/src/server/repositories/versions";
import {
  requireWorkspaceRole,
  WorkspaceAccessError,
  workspaceRoles,
} from "@/src/server/workspace-access";

type ChangelogRoute = {
  params: Promise<{ workspaceId: string; projectId: string; handoffId: string }>;
};

const generateSchema = z.object({
  fromVersionId: z.string().uuid(),
  toVersionId: z.string().uuid(),
});

export async function GET(request: Request, context: ChangelogRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const handoff = getHandoff({ workspaceId, projectId, handoffId });
    if (!handoff) return Response.json({ error: "Handoff not found." }, { status: 404 });

    const drafts = listChangelogDrafts({ workspaceId, handoffId });
    return Response.json({ configured: isAiConfigured(), drafts });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(request: Request, context: ChangelogRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;
  try {
    const actor = await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const handoff = getHandoff({ workspaceId, projectId, handoffId });
    const project = getProject({ workspaceId, projectId });
    if (!handoff || !project) return Response.json({ error: "Handoff not found." }, { status: 404 });

    const parsed = generateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Choose two valid versions to compare." }, { status: 400 });
    const { fromVersionId, toVersionId } = parsed.data;
    if (fromVersionId === toVersionId) {
      return Response.json({ error: "Choose two different versions." }, { status: 400 });
    }

    const from = getVersion({ workspaceId, versionId: fromVersionId });
    const to = getVersion({ workspaceId, versionId: toVersionId });
    if (!from || !to || from.handoffId !== handoffId || to.handoffId !== handoffId) {
      return Response.json({ error: "The selected versions were not found in this handoff." }, { status: 404 });
    }

    const frameMatches = getConfirmedFrameMatchesBetweenVersions({ workspaceId, handoffId, from, to });
    const nodeMatches = getConfirmedNodeMatchesBetweenVersions({ workspaceId, handoffId, from, to });

    const draft = await createEvidenceLinkedDraft({
      workspaceId,
      handoffId,
      handoffName: handoff.name,
      from: { id: from.id, versionLabel: from.versionLabel, snapshot: from.snapshot },
      to: { id: to.id, versionLabel: to.versionLabel, snapshot: to.snapshot },
      rules: project.rules,
      frameMatches,
      nodeMatches,
    });
    const saved = createChangelogDraft({
      workspaceId,
      handoffId,
      fromVersionId,
      toVersionId,
      ...draft,
      createdBy: actor.userId,
    });
    return Response.json({ draft: saved }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.name === "AiConfigurationError") {
      return Response.json({ error: error.message, code: "ai_not_configured" }, { status: 503 });
    }
    if (error instanceof Error && error.name === "AiGenerationError") {
      return Response.json({ error: error.message, code: "ai_generation_failed" }, { status: 502 });
    }
    throw error;
  }
}
