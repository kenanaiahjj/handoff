import { getDatabase } from "../db";
import type { WorkspaceRole } from "../workspace-access";

/**
 * The roles a person picks for themselves. Product designers manage handoffs (they upload captures);
 * everyone else sees only the handoffs shared with them.
 */
export const jobRoles = {
  designer: { label: "Product designer", description: "Capture and publish handoffs.", workspaceRole: "designer" },
  dev: { label: "Developer", description: "Build from specs and measurements.", workspaceRole: "developer" },
  qa: { label: "QA", description: "Check builds against the design.", workspaceRole: "qa" },
  pm: { label: "Product manager", description: "Review handoffs, lead projects.", workspaceRole: "reviewer" },
  marketing: { label: "Marketing", description: "Follow launches, grab final screens.", workspaceRole: "reviewer" },
  exec: { label: "Executive", description: "Follow progress and sign off.", workspaceRole: "reviewer" },
} as const satisfies Record<string, { label: string; description: string; workspaceRole: WorkspaceRole }>;

export type JobRole = keyof typeof jobRoles;

export function isJobRole(value: unknown): value is JobRole {
  return typeof value === "string" && Object.hasOwn(jobRoles, value);
}

/** Company email domains allowed to sign up, from ASBIR_ALLOWED_EMAIL_DOMAINS ("lmf.ventures,plxrmedia.com"). */
export function allowedEmailDomains() {
  return (process.env.ASBIR_ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function emailDomain(email: string) {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/** True when no list is set (open sign-up) or the email belongs to one of the company domains. */
export function isAllowedEmail(email: string) {
  const allowed = allowedEmailDomains();
  return !allowed.length || allowed.includes(emailDomain(email));
}

type OnboardingUser = { id: string; email: string; emailVerified: boolean | number };

/**
 * Workspaces a new teammate joins on their own. The app serves one company, so a verified email
 * from a company domain joins every workspace; anyone else needs an invite link.
 */
export function joinableWorkspaces(user: OnboardingUser) {
  if (!user.emailVerified || !allowedEmailDomains().includes(emailDomain(user.email))) return [];
  return getDatabase()
    .prepare(
      `SELECT workspace.id, workspace.name
       FROM workspace
       WHERE NOT EXISTS (
         SELECT 1 FROM workspace_membership
         WHERE workspace_membership.workspace_id = workspace.id AND workspace_membership.user_id = ?
       )
       ORDER BY workspace.created_at ASC`,
    )
    .all(user.id) as Array<{ id: string; name: string }>;
}

export function getJobRole(userId: string): JobRole | null {
  const row = getDatabase().prepare("SELECT job_role AS jobRole FROM user_profile WHERE user_id = ?").get(userId) as
    | { jobRole: JobRole }
    | undefined;
  return row?.jobRole ?? null;
}

/** New people with no workspace yet and no role picked go through onboarding first. */
export function needsOnboarding(userId: string) {
  if (getJobRole(userId)) return false;
  const membership = getDatabase().prepare("SELECT 1 FROM workspace_membership WHERE user_id = ? LIMIT 1").get(userId);
  return !membership;
}

/** Saves the picked role and joins every workspace open to this person's company domain. */
export function completeOnboarding(user: OnboardingUser, jobRole: JobRole) {
  const database = getDatabase();
  const now = new Date().toISOString();
  const workspaces = joinableWorkspaces(user);
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO user_profile (user_id, job_role, onboarded_at) VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET job_role = excluded.job_role`,
      )
      .run(user.id, jobRole, now);
    const join = database.prepare(
      "INSERT OR IGNORE INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
    );
    for (const workspace of workspaces) join.run(workspace.id, user.id, jobRoles[jobRole].workspaceRole, now);
  })();
  return workspaces;
}
