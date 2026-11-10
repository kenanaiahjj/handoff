import { getHandoff } from "../repositories/handoffs";
import { getVersion } from "../repositories/versions";

export function loadHandoff(workspaceId: string, projectId: string, handoffId: string) {
  const handoff = getHandoff({ workspaceId, projectId, handoffId });
  if (!handoff) throw new Error("Handoff not found in this workspace.");
  return handoff;
}

export function loadVersion(
  workspaceId: string,
  input: { projectId: string; handoffId: string; versionId: string },
) {
  loadHandoff(workspaceId, input.projectId, input.handoffId);
  const version = getVersion({ workspaceId, versionId: input.versionId });
  if (!version || version.handoffId !== input.handoffId) {
    throw new Error("Version not found in this handoff.");
  }
  return version;
}
