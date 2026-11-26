import { getDatabase } from "../db";

/** Last-used times are written at most this often per client, so busy agents don't write on every call. */
export const lastUsedThrottleMs = 5 * 60 * 1000;

/** Before the mcp_client_connection migration runs, MCP keeps working; tracking and revoking just wait for it. */
export function isMissingSchema(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703";
}

/**
 * Called on every OAuth MCP request. Returns false when this person revoked the client after the
 * access token was issued; otherwise records the workspace and (throttled) last-used time.
 */
export async function checkAndTouchMcpClient(input: { userId: string; clientId: string; workspaceId: string; issuedAt: number | null; now?: Date }) {
  const now = input.now ?? new Date();
  const database = getDatabase();
  try {
    const rows = (await database
      .prepare(`SELECT workspace_id AS "workspaceId", last_used_at AS "lastUsedAt", revoked_at AS "revokedAt" FROM mcp_client_connection WHERE user_id = ? AND client_id = ?`)
      .all(input.userId, input.clientId)) as Array<{ workspaceId: string; lastUsedAt: string; revokedAt: string | null }>;
    const revokedAt = rows.reduce((latest, row) => Math.max(latest, row.revokedAt ? Date.parse(row.revokedAt) : 0), 0);
    // A token with no issue time can't be shown to postdate the revoke, so it's refused too.
    if (revokedAt && (input.issuedAt === null || input.issuedAt * 1000 <= revokedAt)) return false;

    const current = rows.find((row) => row.workspaceId === input.workspaceId);
    const stale = !current
      || Date.parse(current.lastUsedAt) <= now.getTime() - lastUsedThrottleMs
      || (current.revokedAt !== null && Date.parse(current.revokedAt) >= Date.parse(current.lastUsedAt));
    if (stale) {
      const at = now.toISOString();
      await database
        .prepare(
          `INSERT INTO mcp_client_connection (user_id, client_id, workspace_id, first_used_at, last_used_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (user_id, client_id, workspace_id) DO UPDATE SET last_used_at = EXCLUDED.last_used_at`,
        )
        .run(input.userId, input.clientId, input.workspaceId, at, at);
    }
    return true;
  } catch (error) {
    if (isMissingSchema(error)) return true;
    throw error;
  }
}

export type McpClientConnection = {
  userId: string;
  userName: string;
  clientId: string;
  clientName: string;
  firstUsedAt: string;
  lastUsedAt: string;
  revokedAt: string | null;
};

/** A client used again after it was revoked has signed in afresh, so it counts as connected. */
export function isConnectionActive(connection: Pick<McpClientConnection, "lastUsedAt" | "revokedAt">) {
  return !connection.revokedAt || Date.parse(connection.lastUsedAt) > Date.parse(connection.revokedAt);
}

export async function listMcpClientConnections(input: { workspaceId: string; userId: string; includeAll: boolean }): Promise<McpClientConnection[]> {
  const scopeFilter = input.includeAll ? "" : " AND connection.user_id = ?";
  try {
    const rows = (await getDatabase()
      .prepare(
        `SELECT connection.user_id AS "userId", COALESCE("user".name, '') AS "userName",
                connection.client_id AS "clientId", COALESCE(NULLIF(trim(client.name), ''), 'AI client') AS "clientName",
                connection.first_used_at AS "firstUsedAt", connection.last_used_at AS "lastUsedAt", connection.revoked_at AS "revokedAt"
         FROM mcp_client_connection AS connection
         JOIN "user" ON "user".id = connection.user_id
         LEFT JOIN "oauthClient" AS client ON client."clientId" = connection.client_id
         WHERE connection.workspace_id = ?${scopeFilter}
         ORDER BY connection.last_used_at DESC LIMIT 200`,
      )
      .all(...(input.includeAll ? [input.workspaceId] : [input.workspaceId, input.userId]))) as McpClientConnection[];
    return rows;
  } catch (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
}

/**
 * Disconnects one person's AI client. Owners and designers can disconnect anyone's client in their
 * workspace; everyone else only their own. The sign-in belongs to the person, so it ends everywhere.
 */
export async function revokeMcpClientConnection(input: { workspaceId: string; userId: string; clientId: string; actorId: string; canManageAll: boolean; now?: Date }) {
  if (!input.canManageAll && input.userId !== input.actorId) return false;
  const database = getDatabase();
  const at = (input.now ?? new Date()).toISOString();
  const result = await database
    .prepare(
      `UPDATE mcp_client_connection SET revoked_at = ?, revoked_by_user_id = ?
       WHERE user_id = ? AND client_id = ?
         AND EXISTS (SELECT 1 FROM mcp_client_connection AS here WHERE here.user_id = ? AND here.client_id = ? AND here.workspace_id = ?)`,
    )
    .run(at, input.actorId, input.userId, input.clientId, input.userId, input.clientId, input.workspaceId);
  if (result.changes === 0) return false;
  // No silent refresh into a new token, and the next sign-in asks for Allow again.
  await database.prepare(`DELETE FROM "oauthRefreshToken" WHERE "userId" = ? AND "clientId" = ?`).run(input.userId, input.clientId);
  await database.prepare(`DELETE FROM "oauthAccessToken" WHERE "userId" = ? AND "clientId" = ?`).run(input.userId, input.clientId);
  await database.prepare(`DELETE FROM "oauthConsent" WHERE "userId" = ? AND "clientId" = ?`).run(input.userId, input.clientId);
  return true;
}
