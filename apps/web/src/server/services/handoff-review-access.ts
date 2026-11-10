import type { AuthSession } from "../auth";
import { getSessionForHeaders } from "../auth-session";
import { getDatabase } from "../db";
import { getHandoffInviteByToken, getPublishedHandoffByShareId, listHandoffVersions } from "../repositories/handoffs";
import { getVersion } from "../repositories/versions";
import { versionsVisibleToReview } from "./published-review";
import { resolveHandoffReviewAccess, type HandoffReviewAccessDecision } from "./handoff-sharing";

export type PublishedReviewHandoff = NonNullable<ReturnType<typeof getPublishedHandoffByShareId>>;

export type PublishedReviewAccess = {
  handoff: PublishedReviewHandoff;
  session: AuthSession | null;
  membershipRole: string | null;
  inviteToken: string | null;
  decision: HandoffReviewAccessDecision;
};

export function listVisiblePublishedReviewVersions(handoff: PublishedReviewHandoff) {
  const versions = listHandoffVersions({ workspaceId: handoff.workspaceId, handoffId: handoff.id }) as Array<{ id: string; versionLabel: string }>;
  return versionsVisibleToReview(versions, handoff.publishedVersionId);
}

export function getVisiblePublishedReviewVersion(handoff: PublishedReviewHandoff, versionId: string) {
  if (!listVisiblePublishedReviewVersions(handoff).some((version) => version.id === versionId)) return null;
  const version = getVersion({ workspaceId: handoff.workspaceId, versionId });
  return version?.handoffId === handoff.id ? version : null;
}

export function handoffReviewAccessCookieName(shareId: string) {
  const safeShareId = shareId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `asbir_review_${safeShareId}`;
}

export function handoffReviewPendingCookieName(shareId: string) {
  const safeShareId = shareId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `asbir_review_pending_${safeShareId}`;
}

function cookieValue(headers: Headers, name: string) {
  const cookies = headers.get("cookie");
  if (!cookies) return null;
  for (const entry of cookies.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(entry.slice(separator + 1).trim()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function hasPendingHandoffReviewInvite(headers: Headers, shareId: string) {
  return Boolean(cookieValue(headers, handoffReviewPendingCookieName(shareId)));
}

export function getHandoffReviewInviteToken(headers: Headers, shareId: string) {
  return cookieValue(headers, handoffReviewAccessCookieName(shareId)) ??
    cookieValue(headers, handoffReviewPendingCookieName(shareId));
}

export async function resolvePublishedReviewAccess(
  shareId: string,
  headers: Headers,
  explicitInviteToken?: string | null,
): Promise<PublishedReviewAccess | null> {
  const handoff = getPublishedHandoffByShareId(shareId);
  if (!handoff) return null;

  const session = await getSessionForHeaders(headers);
  const membership = session
    ? getDatabase()
      .prepare("SELECT role FROM workspace_membership WHERE workspace_id = ? AND user_id = ?")
      .get(handoff.workspaceId, session.user.id) as { role: string } | undefined
    : undefined;
  const inviteToken = explicitInviteToken || getHandoffReviewInviteToken(headers, shareId);
  const invite = inviteToken ? getHandoffInviteByToken(shareId, inviteToken) : null;
  const role = membership?.role ?? null;

  return {
    handoff,
    session,
    membershipRole: role,
    inviteToken,
    decision: resolveHandoffReviewAccess({
      mode: handoff.sharingMode,
      isWorkspaceMember: Boolean(membership),
      isManager: role === "owner" || role === "designer",
      sessionEmail: session?.user.email,
      invite,
      inviteToken,
    }),
  };
}
