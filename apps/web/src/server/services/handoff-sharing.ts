import { createHash } from "node:crypto";

export type HandoffSharingMode = "workspace" | "invited" | "anyone";
export type HandoffInviteRole = "pd" | "qa" | "dev" | "exec";

export type HandoffInviteAccess = {
  id: string;
  email: string;
  role: HandoffInviteRole;
  tokenHash: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type HandoffReviewAccessDecision = {
  allowed: boolean;
  canWrite: boolean;
  canComment: boolean;
  reason:
    | "public-link"
    | "workspace-member"
    | "handoff-manager"
    | "invite-link"
    | "workspace-membership-required"
    | "invite-required"
    | "invite-invalid";
};

export function normalizeInviteEmail(email: string) {
  return email.trim().toLowerCase();
}

export function hashHandoffInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function resolveHandoffReviewAccess(input: {
  mode: HandoffSharingMode;
  isWorkspaceMember: boolean;
  isManager?: boolean;
  isAuthenticated?: boolean;
  sessionEmail?: string | null;
  invite?: HandoffInviteAccess | null;
  inviteToken?: string | null;
  now?: string;
}): HandoffReviewAccessDecision {
  if (input.isWorkspaceMember && input.isManager) {
    return { allowed: true, canWrite: true, canComment: true, reason: "handoff-manager" };
  }

  if (input.mode === "anyone") {
    return input.isWorkspaceMember
      ? { allowed: true, canWrite: true, canComment: true, reason: "workspace-member" }
      : { allowed: true, canWrite: false, canComment: false, reason: "public-link" };
  }

  if (input.mode === "workspace") {
    return input.isWorkspaceMember
      ? { allowed: true, canWrite: true, canComment: true, reason: "workspace-member" }
      : { allowed: false, canWrite: false, canComment: false, reason: "workspace-membership-required" };
  }

  if (!input.inviteToken) {
    return { allowed: false, canWrite: false, canComment: false, reason: "invite-required" };
  }
  if (!input.invite) {
    return { allowed: false, canWrite: false, canComment: false, reason: "invite-invalid" };
  }

  const now = input.now ?? new Date().toISOString();
  const inviteIsActive = !input.invite.revokedAt &&
    (!input.invite.expiresAt || input.invite.expiresAt > now);
  const inviteMatches = hashHandoffInviteToken(input.inviteToken) === input.invite.tokenHash;

  return inviteIsActive && inviteMatches
    ? { allowed: true, canWrite: input.isAuthenticated ?? Boolean(input.sessionEmail), canComment: true, reason: "invite-link" }
    : { allowed: false, canWrite: false, canComment: false, reason: "invite-invalid" };
}
