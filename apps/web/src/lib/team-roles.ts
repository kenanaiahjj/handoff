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
  pm: { label: "Project manager", description: "Review handoffs, lead projects.", workspaceRole: "reviewer" },
  marketing: { label: "Marketing", description: "Follow launches, grab final screens.", workspaceRole: "reviewer" },
  exec: { label: "Executive", description: "Follow progress and sign off.", workspaceRole: "reviewer" },
} as const satisfies Record<string, { label: string; description: string; workspaceRole: WorkspaceRoleName }>;

export type JobRole = keyof typeof jobRoles;

export function isJobRole(value: unknown): value is JobRole {
  return typeof value === "string" && Object.hasOwn(jobRoles, value);
}

/** Roles people can pick for themselves at sign-up. Executives are added by an owner instead. */
export const selfServeJobRoles: readonly JobRole[] = (Object.keys(jobRoles) as JobRole[]).filter((role) => role !== "exec");

export function isSelfServeJobRole(value: unknown): value is JobRole {
  return isJobRole(value) && selfServeJobRoles.includes(value);
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

/** The job role a workspace role implies when an owner sets access directly (Reviewer implies none). */
const jobForWorkspaceRole: Partial<Record<string, JobRole>> = { designer: "designer", developer: "dev", qa: "qa" };

/** Whether a stored job role still agrees with someone's access (a pending designer is still a reviewer). */
function jobMatchesAccess(job: JobRole, role: string) {
  return workspaceRoleForInvite(job) === role || jobRoles[job].workspaceRole === role;
}

/**
 * The one role people see for a member: what they do (Marketing, QA…), not the access behind it.
 * A job role left over from onboarding that no longer matches their access is ignored.
 */
export function memberRoleValue(role: string, jobRole: string | null): InviteRole | "reviewer" {
  if (role === "owner") return "owner";
  if (isJobRole(jobRole) && jobMatchesAccess(jobRole, role)) return jobRole;
  return jobForWorkspaceRole[role] ?? "reviewer";
}

export function memberRoleLabel(role: string, jobRole: string | null) {
  const value = memberRoleValue(role, jobRole);
  return value === "reviewer" ? "Reviewer" : inviteRoleLabel(value);
}

/** The job role to store when an owner changes someone's access directly, or null to leave it. */
export function jobRoleForAccessChange(role: string, currentJob: string | null): JobRole | null {
  if (isJobRole(currentJob) && jobMatchesAccess(currentJob, role)) return null;
  return jobForWorkspaceRole[role] ?? null;
}

/** Label for an older invite stored with only a workspace role. */
export function workspaceRoleLabel(role: string) {
  return ({ owner: "Owner", designer: "Product designer", reviewer: "Reviewer", developer: "Developer", qa: "QA" } as Record<string, string>)[role] ?? role;
}

/** What each workspace role can do, for the role guide on the Team page. Keep in sync with the access checks. */
export const workspaceRoleDetails: Array<{ role: WorkspaceRoleName; label: string; summary: string; can: string[] }> = [
  {
    role: "owner",
    label: "Owner",
    summary: "Runs the workspace.",
    can: ["Everything a designer can do", "Invite people, change roles and remove members", "Approve designer requests", "Add owners by email"],
  },
  {
    role: "designer",
    label: "Product designer",
    summary: "Captures and publishes handoffs.",
    can: ["Capture from the Figma plugin", "Create projects and handoffs, publish versions", "Share handoffs and see the whole workspace", "See the member list"],
  },
  {
    role: "reviewer",
    label: "Reviewer",
    summary: "Reviews what is shared with them.",
    can: ["Open handoffs shared with them or with the workspace", "Inspect, measure and export assets", "Comment and reply"],
  },
  {
    role: "developer",
    label: "Developer",
    summary: "Same access as Reviewer.",
    can: ["Builds from specs; the role tells teammates what they do"],
  },
  {
    role: "qa",
    label: "QA",
    summary: "Same access as Reviewer.",
    can: ["Checks builds against the design; the role tells teammates what they do"],
  },
];
