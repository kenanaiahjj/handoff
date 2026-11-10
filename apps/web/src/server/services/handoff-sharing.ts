import { createHash } from "node:crypto";

export type HandoffSharingMode = "workspace" | "invited" | "anyone";

export type HandoffInviteAccess = {
  email: string;
  tokenHash: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type HandoffReviewAccessDecision = {
  allowed: boolean;
  canWrite: boolean;
  reason:
    | "public-link"
    | "workspace-member"
    | "handoff-manager"
    | "invited-recipient"
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
  sessionEmail?: string | null;
  invite?: HandoffInviteAccess | null;
  inviteToken?: string | null;
  now?: string;
}): HandoffReviewAccessDecision {
  if (input.isWorkspaceMember && input.isManager) {
    return { allowed: true, canWrite: true, reason: "handoff-manager" };
  }

  if (input.mode === "anyone") {
    return input.isWorkspaceMember
      ? { allowed: true, canWrite: true, reason: "workspace-member" }
      : { allowed: true, canWrite: false, reason: "public-link" };
  }

  if (input.mode === "workspace") {
    return input.isWorkspaceMember
      ? { allowed: true, canWrite: true, reason: "workspace-member" }
      : { allowed: false, canWrite: false, reason: "workspace-membership-required" };
  }

  if (!input.inviteToken || !input.sessionEmail || !input.invite) {
    return { allowed: false, canWrite: false, reason: "invite-required" };
  }

  const now = input.now ?? new Date().toISOString();
  const inviteIsActive = !input.invite.revokedAt &&
    (!input.invite.expiresAt || input.invite.expiresAt > now);
  const inviteMatches = hashHandoffInviteToken(input.inviteToken) === input.invite.tokenHash &&
    normalizeInviteEmail(input.sessionEmail) === normalizeInviteEmail(input.invite.email);

  return inviteIsActive && inviteMatches
    ? { allowed: true, canWrite: true, reason: "invited-recipient" }
    : { allowed: false, canWrite: false, reason: "invite-invalid" };
}
