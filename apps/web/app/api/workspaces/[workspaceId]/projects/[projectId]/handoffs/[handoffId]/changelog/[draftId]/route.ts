import { z } from "zod";
import { generatedChangelogSchema } from "@/src/server/ai/schema";
import { getChangelogDraft, updateChangelogDraft } from "@/src/server/repositories/changelogs";
import { getHandoff } from "@/src/server/repositories/handoffs";
import {
  requireWorkspaceRole,
  WorkspaceAccessError,
  workspaceRoles,
} from "@/src/server/workspace-access";
import { requireProjectMember } from "@/src/server/workspace-access";

type DraftRoute = {
  params: Promise<{ workspaceId: string; projectId: string; handoffId: string; draftId: string }>;
};

const updateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(2000),
  statements: generatedChangelogSchema.shape.statements,
  status: z.enum(["draft", "approved"]),
});

export async function PATCH(request: Request, context: DraftRoute) {
  const { workspaceId, projectId, handoffId, draftId } = await context.params;
  try {
    await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    if (!getHandoff({ workspaceId, projectId, handoffId })) {
      return Response.json({ error: "Handoff not found." }, { status: 404 });
    }
    const existing = getChangelogDraft({ workspaceId, handoffId, draftId });
    if (!existing) return Response.json({ error: "Changelog draft not found." }, { status: 404 });

    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Check the changelog fields and try again." }, { status: 400 });
    await requireProjectMember(request, workspaceId, projectId);
    const evidenceIds = new Set(existing.evidence.map((item) => item.id));
    if (parsed.data.statements.some((statement) => statement.evidence.some((id) => !evidenceIds.has(id)))) {
      return Response.json({ error: "Each statement must use evidence from this draft." }, { status: 400 });
    }

    const updated = updateChangelogDraft({
      workspaceId,
      handoffId,
      draftId,
      ...parsed.data,
    });
    if (!updated) return Response.json({ error: "Changelog draft not found." }, { status: 404 });
    return Response.json({ draft: getChangelogDraft({ workspaceId, handoffId, draftId }) });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
