import { finalizeChangelogDraft } from "@/src/server/ai/draft-changelog";
import { generateChangelog, isAiConfigured } from "@/src/server/ai/openai-provider";
import { createChangelogDraft, listChangelogDrafts } from "@/src/server/repositories/changelogs";
import { getHandoff } from "@/src/server/repositories/handoffs";
import { changelogErrorResponse, resolveChangelogRequest } from "@/src/server/services/changelog-request";
import {
  requireWorkspaceRole,
  WorkspaceAccessError,
  workspaceRoles,
  requireHandoffAccess,
} from "@/src/server/workspace-access";

type ChangelogRoute = {
  params: Promise<{ workspaceId: string; projectId: string; handoffId: string }>;
};

export async function GET(request: Request, context: ChangelogRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;
  try {
    await requireHandoffAccess(request, { workspaceId, handoffId });
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
  try {
    const resolved = await resolveChangelogRequest(request, await context.params);
    if (!resolved.ok) return resolved.response;

    const generated = await generateChangelog(resolved.prepared.generationInput);
    const draft = finalizeChangelogDraft(resolved.prepared, generated);
    const saved = createChangelogDraft({
      workspaceId: resolved.workspaceId,
      handoffId: resolved.handoffId,
      fromVersionId: resolved.fromVersionId,
      toVersionId: resolved.toVersionId,
      ...draft,
      createdBy: resolved.actorId,
    });
    return Response.json({ draft: saved }, { status: 201 });
  } catch (error) {
    return changelogErrorResponse(error);
  }
}
