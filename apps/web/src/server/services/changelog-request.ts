import { z } from "zod";
import { prepareChangelogDraft } from "@/src/server/ai/draft-changelog";
import { getHandoff } from "@/src/server/repositories/handoffs";
import { getProject } from "@/src/server/repositories/projects";
import {
  getConfirmedFrameMatchesBetweenVersions,
  getConfirmedNodeMatchesBetweenVersions,
  getVersion,
} from "@/src/server/repositories/versions";
import { requireWorkspaceRole, WorkspaceAccessError, workspaceRoles } from "@/src/server/workspace-access";

const generateSchema = z.object({
  fromVersionId: z.string().uuid(),
  toVersionId: z.string().uuid(),
});

type ChangelogRequestResult =
  | { ok: false; response: Response }
  | {
      ok: true;
      actorId: string;
      workspaceId: string;
      handoffId: string;
      fromVersionId: string;
      toVersionId: string;
      prepared: ReturnType<typeof prepareChangelogDraft>;
    };

/** Authorizes and validates a changelog generation request, then collects its evidence. */
export async function resolveChangelogRequest(
  request: Request,
  params: { workspaceId: string; projectId: string; handoffId: string },
): Promise<ChangelogRequestResult> {
  const { workspaceId, projectId, handoffId } = params;
  const actor = await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
  const handoff = getHandoff({ workspaceId, projectId, handoffId });
  const project = getProject({ workspaceId, projectId });
  if (!handoff || !project) return { ok: false, response: Response.json({ error: "Handoff not found." }, { status: 404 }) };

  const parsed = generateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return { ok: false, response: Response.json({ error: "Choose two valid versions to compare." }, { status: 400 }) };
  const { fromVersionId, toVersionId } = parsed.data;
  if (fromVersionId === toVersionId) {
    return { ok: false, response: Response.json({ error: "Choose two different versions." }, { status: 400 }) };
  }

  const from = getVersion({ workspaceId, versionId: fromVersionId });
  const to = getVersion({ workspaceId, versionId: toVersionId });
  if (!from || !to || from.handoffId !== handoffId || to.handoffId !== handoffId) {
    return { ok: false, response: Response.json({ error: "The selected versions were not found in this handoff." }, { status: 404 }) };
  }

  const prepared = prepareChangelogDraft({
    workspaceId,
    handoffId,
    handoffName: handoff.name,
    from: { id: from.id, versionLabel: from.versionLabel, snapshot: from.snapshot },
    to: { id: to.id, versionLabel: to.versionLabel, snapshot: to.snapshot },
    rules: project.rules,
    frameMatches: getConfirmedFrameMatchesBetweenVersions({ workspaceId, handoffId, from, to }),
    nodeMatches: getConfirmedNodeMatchesBetweenVersions({ workspaceId, handoffId, from, to }),
  });

  return { ok: true, actorId: actor.userId, workspaceId, handoffId, fromVersionId, toVersionId, prepared };
}

/** Maps auth and AI failures to the JSON error responses the changelog panel expects. */
export function changelogErrorResponse(error: unknown) {
  if (error instanceof WorkspaceAccessError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error && error.name === "AiConfigurationError") {
    return Response.json({ error: error.message, code: "ai_not_configured" }, { status: 503 });
  }
  if (error instanceof Error && error.name === "AiGenerationError") {
    return Response.json({ error: error.message, code: "ai_generation_failed" }, { status: 502 });
  }
  if (error instanceof Error && error.message.startsWith("The generated draft referenced evidence")) {
    return Response.json({ error: error.message, code: "ai_generation_failed" }, { status: 502 });
  }
  throw error;
}
