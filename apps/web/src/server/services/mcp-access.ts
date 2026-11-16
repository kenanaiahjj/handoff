import { getHandoff } from "../repositories/handoffs";
import { getVersion } from "../repositories/versions";

/**
 * `allowedHandoffIds` scopes a reviewer's token to the handoffs shared with them; `null` or
 * omitted means the token's creator can see the whole workspace. Hidden handoffs report the
 * same "not found" error as missing ones, so a token can't probe for what exists.
 */
export function loadHandoff(workspaceId: string, projectId: string, handoffId: string, allowedHandoffIds?: Set<string> | null) {
  const handoff = getHandoff({ workspaceId, projectId, handoffId });
  if (!handoff || (allowedHandoffIds && !allowedHandoffIds.has(handoffId))) throw new Error("Handoff not found in this workspace.");
  return handoff;
}

export function loadVersion(
  workspaceId: string,
  input: { projectId: string; handoffId: string; versionId: string },
  allowedHandoffIds?: Set<string> | null,
) {
  loadHandoff(workspaceId, input.projectId, input.handoffId, allowedHandoffIds);
  const version = getVersion({ workspaceId, versionId: input.versionId });
  if (!version || version.handoffId !== input.handoffId) {
    throw new Error("Version not found in this handoff.");
  }
  return version;
}

/** Loaders bound to one token's visibility, for use inside MCP tool handlers. */
export function scopedLoaders(allowedHandoffIds: Set<string> | null) {
  return {
    loadHandoff: (workspaceId: string, projectId: string, handoffId: string) =>
      loadHandoff(workspaceId, projectId, handoffId, allowedHandoffIds),
    loadVersion: (workspaceId: string, input: { projectId: string; handoffId: string; versionId: string }) =>
      loadVersion(workspaceId, input, allowedHandoffIds),
  };
}
