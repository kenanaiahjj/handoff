/**
 * The roles people have on the team, shared by onboarding (people pick their own) and invite links
 * (an owner picks for them), so both lists always match. Client-safe: no server imports.
 */
type WorkspaceRoleName = "owner" | "designer" | "reviewer" | "developer" | "qa";

/**
 * Job roles. Product designers manage handoffs (they upload captures); signing up as one waits for
 * an owner's approval, so they start as a reviewer. Everyone else sees only what is shared with them.
 */
export const jobRoles = {
  designer: { label: "Product designer", description: "Request access to capture and publish handoffs.", workspaceRole: "reviewer" },
  dev: { label: "Developer", description: "Build from specs and measurements.", workspaceRole: "developer" },
  qa: { label: "QA", description: "Check builds against the design.", workspaceRole: "qa" },
  pm: { label: "Product manager", description: "Review handoffs, lead projects.", workspaceRole: "reviewer" },
  marketing: { label: "Marketing", description: "Follow launches, grab final screens.", workspaceRole: "reviewer" },
  exec: { label: "Executive", description: "Follow progress and sign off.", workspaceRole: "reviewer" },
} as const satisfies Record<string, { label: string; description: string; workspaceRole: WorkspaceRoleName }>;

export type JobRole = keyof typeof jobRoles;

export function isJobRole(value: unknown): value is JobRole {
  return typeof value === "string" && Object.hasOwn(jobRoles, value);
}

/** What an invite link can grant: every job role, plus Owner. */
export const inviteRoles = [...(Object.keys(jobRoles) as JobRole[]), "owner"] as const;
export type InviteRole = JobRole | "owner";

export function isInviteRole(value: unknown): value is InviteRole {
  return value === "owner" || isJobRole(value);
}

export function inviteRoleLabel(role: InviteRole) {
  return role === "owner" ? "Owner" : jobRoles[role].label;
}

/**
 * The access an invite grants. An owner made the link, so a Product designer invite gives designer
 * access right away (self sign-up as a designer still waits for approval).
 */
export function workspaceRoleForInvite(role: InviteRole): WorkspaceRoleName {
  if (role === "owner") return "owner";
  if (role === "designer") return "designer";
  return jobRoles[role].workspaceRole;
}

/** Label for an older invite stored with only a workspace role. */
export function workspaceRoleLabel(role: string) {
  return ({ owner: "Owner", designer: "Product designer", reviewer: "Reviewer", developer: "Developer", qa: "QA" } as Record<string, string>)[role] ?? role;
}
