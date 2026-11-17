import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "@/src/server/db";
import { getSessionForRequest } from "@/src/server/workspace-access";
import { jobRoles, workspaceRoleLabel, type JobRole } from "@/src/lib/team-roles";

function digestToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function findInvite(token: string) {
  return (await getDatabase()
    .prepare(
      `SELECT workspace_invite.id, workspace_invite.workspace_id AS workspaceId,
              workspace_invite.role, workspace_invite.job_role AS jobRole, workspace_invite.expires_at AS expiresAt,
              workspace_invite.reusable,
              workspace.name AS workspaceName
       FROM workspace_invite
       JOIN workspace ON workspace.id = workspace_invite.workspace_id
       WHERE workspace_invite.token_hash = ?
         AND workspace_invite.revoked_at IS NULL
         AND (workspace_invite.expires_at IS NULL OR workspace_invite.expires_at > ?)
         AND (workspace_invite.reusable IS TRUE OR workspace_invite.accepted_at IS NULL)`,
    )
    .get(digestToken(token), new Date().toISOString())) as
    | {
        id: string;
        workspaceId: string;
        role: string;
        jobRole: JobRole | null;
        expiresAt: string | null;
        reusable: number;
        workspaceName: string;
      }
    | undefined;
}

export async function GET(
  _request: Request,
  context: RouteContext<"/api/invites/[token]">,
) {
  const { token } = await context.params;
  const invite = (await findInvite(token));

  if (!invite) {
    return Response.json({ error: "This invitation is invalid, expired, or revoked." }, { status: 404 });
  }

  return Response.json({
    workspaceName: invite.workspaceName,
    role: invite.role,
    roleLabel: invite.jobRole ? jobRoles[invite.jobRole].label : workspaceRoleLabel(invite.role),
    expiresAt: invite.expiresAt,
    reusable: Boolean(invite.reusable),
  });
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/invites/[token]">,
) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in before accepting this invitation." }, { status: 401 });

  const { token } = await context.params;
  const invite = (await findInvite(token));
  if (!invite) {
    return Response.json({ error: "This invitation is invalid, expired, or revoked." }, { status: 404 });
  }

  const acceptedAt = new Date().toISOString();
  const database = getDatabase();
  const acceptInvite = database.transaction(async () => {
    const stillValid = (await database
      .prepare(
        `SELECT reusable FROM workspace_invite
         WHERE id = ? AND token_hash = ? AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
           AND (reusable IS TRUE OR accepted_at IS NULL)`,
      )
      .get(invite.id, digestToken(token), acceptedAt)) as { reusable: number } | undefined;
    if (!stillValid) return false;

    if (!stillValid.reusable) {
      const result = (await database
        .prepare(
          `UPDATE workspace_invite SET accepted_at = ?
           WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL
             AND (expires_at IS NULL OR expires_at > ?)`,
        )
        .run(acceptedAt, invite.id, acceptedAt));
      if (result.changes !== 1) return false;
    }

    (await database
      .prepare(
        `INSERT INTO workspace_membership (workspace_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      )
      .run(invite.workspaceId, session.user.id, invite.role, acceptedAt));

    // The invite says what they do, so they skip picking a role in onboarding.
    if (invite.jobRole) {
      (await database
        .prepare(
          `INSERT INTO user_profile (user_id, job_role, onboarded_at) VALUES (?, ?, ?)
           ON CONFLICT (user_id) DO NOTHING`,
        )
        .run(session.user.id, invite.jobRole, acceptedAt));
    }

    return true;
  });

  if (!(await acceptInvite())) {
    return Response.json({ error: "This invitation is invalid, expired, or revoked." }, { status: 404 });
  }

  return Response.json({ workspaceId: invite.workspaceId });
}
