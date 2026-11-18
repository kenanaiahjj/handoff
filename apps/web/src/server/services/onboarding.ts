import { getDatabase } from "../db";
import { isJobRole, jobRoles, type JobRole } from "@/src/lib/team-roles";

// The role list lives in src/lib/team-roles.ts, shared with invite links.
export { isJobRole, jobRoles, type JobRole };

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

/**
 * Company domains that may sign up and join on their own. The app serves one company, so the
 * first workspace's setting applies; without one, the deployment's environment list does.
 */
export async function companyEmailDomains() {
  try {
    const row = (await getDatabase()
      .prepare("SELECT allowed_email_domains AS domains FROM workspace ORDER BY created_at ASC, id ASC LIMIT 1")
      .get()) as { domains: string | null } | undefined;
    if (row?.domains != null) return row.domains.split(",").filter(Boolean);
  } catch {
    // Before the settings migration runs, fall back to the environment.
  }
  return allowedEmailDomains();
}

/** Like isAllowedEmail, but honours the domains an owner saved in workspace Settings. */
export async function isAllowedCompanyEmail(email: string) {
  const allowed = await companyEmailDomains();
  return !allowed.length || allowed.includes(emailDomain(email));
}

type OnboardingUser = { id: string; email: string; emailVerified: boolean | number };

/**
 * Workspaces a new teammate joins on their own. The app serves one company, so a verified email
 * from a company domain joins every workspace; anyone else needs an invite link.
 */
export async function joinableWorkspaces(user: OnboardingUser) {
  if (!user.emailVerified || !(await companyEmailDomains()).includes(emailDomain(user.email))) return [];
  return (await getDatabase()
    .prepare(
      `SELECT workspace.id, workspace.name
       FROM workspace
       WHERE NOT EXISTS (
         SELECT 1 FROM workspace_membership
         WHERE workspace_membership.workspace_id = workspace.id AND workspace_membership.user_id = ?
       )
       ORDER BY workspace.created_at ASC`,
    )
    .all(user.id)) as Array<{ id: string; name: string }>;
}

export async function getJobRole(userId: string): Promise<JobRole | null> {
  const row = (await getDatabase().prepare("SELECT job_role AS jobRole FROM user_profile WHERE user_id = ?").get(userId)) as
    | { jobRole: JobRole }
    | undefined;
  return row?.jobRole ?? null;
}

/** New people with no workspace yet and no role picked go through onboarding first. */
export async function needsOnboarding(userId: string) {
  if ((await getJobRole(userId))) return false;
  const membership = (await getDatabase().prepare("SELECT 1 FROM workspace_membership WHERE user_id = ? LIMIT 1").get(userId));
  return !membership;
}

/** Saves the picked role and joins every workspace open to this person's company domain. */
export async function completeOnboarding(user: OnboardingUser, jobRole: JobRole) {
  const database = getDatabase();
  const now = new Date().toISOString();
  const workspaces = (await joinableWorkspaces(user));
  await database.transaction(async () => {
    (await database
      .prepare(
        `INSERT INTO user_profile (user_id, job_role, onboarded_at) VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET job_role = excluded.job_role`,
      )
      .run(user.id, jobRole, now));
    const join = database.prepare(
      "INSERT INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
    );
    // Designer access lets someone publish and remove screens, so it waits for an owner's approval;
    // until then they review like everyone else.
    (await database.prepare("UPDATE user_profile SET requested_role = ? WHERE user_id = ?").run(jobRole === "designer" ? "designer" : null, user.id));
    for (const workspace of workspaces) await join.run(workspace.id, user.id, jobRoles[jobRole].workspaceRole, now);
  })();
  return workspaces;
}
