import type { StoredSnapshot } from "../repositories/versions";
import { createLinkedExternalTask } from "../repositories/linked-external-tasks";
import type { TaskLinkInput } from "./task-context";
import { resolveTaskDesignContext, taskCanvasHref } from "./task-context";

export function linkExternalTaskToHandoff(input: {
  workspaceId: string;
  handoffId: string;
  version: {
    id: string;
    versionLabel: string;
    sourceRevisionId: string | null;
    contentHash: string;
    snapshot: StoredSnapshot;
  };
  handoffUrl: string;
  task: TaskLinkInput;
  createdBy: string;
}) {
  const designContext = resolveTaskDesignContext(
    input.version.snapshot,
    input.task.frameId,
    input.task.sourceNodeId,
  );
  const canvasUrl = taskCanvasHref(input.handoffUrl, designContext);
  return createLinkedExternalTask({
    workspaceId: input.workspaceId,
    handoffId: input.handoffId,
    versionId: input.version.id,
    sourceSystem: input.task.sourceSystem,
    externalTaskId: input.task.externalTaskId ?? null,
    externalUrl: input.task.externalUrl ?? null,
    title: input.task.title,
    description: input.task.description,
    evidence: {
      versionId: input.version.id,
      versionLabel: input.version.versionLabel,
      sourceRevisionId: input.version.sourceRevisionId,
      contentHash: input.version.contentHash,
      handoffUrl: canvasUrl,
      designContext,
    },
    createdBy: input.createdBy,
  });
}
