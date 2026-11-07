import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDatabase } from "../db";

export const mcpScopes = ["handoffs:read", "comments:write", "changelog:write", "tasks:write"] as const;
export type McpScope = (typeof mcpScopes)[number];

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createWorkspaceMcpToken(input: {
  workspaceId: string;
  createdBy: string;
  name: string;
  scopes: McpScope[];
  expiresInDays: number;
}) {
  const secret = `asbir_mcp_${randomBytes(32).toString("base64url")}`;
  const id = randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO workspace_mcp_token
        (id, workspace_id, created_by_user_id, name, token_hash, scopes_json, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.workspaceId, input.createdBy, input.name.trim(), hashToken(secret), JSON.stringify(input.scopes), expiresAt, createdAt.toISOString());
  return {
    token: secret,
    metadata: { id, name: input.name.trim(), scopes: input.scopes, expiresAt, createdAt: createdAt.toISOString(), revokedAt: null, expired: false },
  };
}

export function listWorkspaceMcpTokens(input: { workspaceId: string; userId: string; includeAll: boolean }) {
  const scopeFilter = input.includeAll ? "" : " AND workspace_mcp_token.created_by_user_id = ?";
  const rows = getDatabase()
    .prepare(
      `SELECT workspace_mcp_token.id, workspace_mcp_token.name,
              workspace_mcp_token.scopes_json AS scopesJson, workspace_mcp_token.expires_at AS expiresAt,
              workspace_mcp_token.revoked_at AS revokedAt, workspace_mcp_token.created_at AS createdAt,
              workspace_mcp_token.created_by_user_id AS createdBy, "user".name AS createdByName
       FROM workspace_mcp_token
       JOIN "user" ON "user".id = workspace_mcp_token.created_by_user_id
       WHERE workspace_mcp_token.workspace_id = ?${scopeFilter}
       ORDER BY workspace_mcp_token.created_at DESC LIMIT 100`,
    )
    .all(...(input.includeAll ? [input.workspaceId] : [input.workspaceId, input.userId])) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    scopes: JSON.parse(row.scopesJson as string) as McpScope[],
    expiresAt: row.expiresAt as string,
    revokedAt: row.revokedAt as string | null,
    createdAt: row.createdAt as string,
    createdBy: row.createdBy as string,
    createdByName: row.createdByName as string,
    expired: Date.parse(row.expiresAt as string) <= Date.now(),
  }));
}

export function revokeWorkspaceMcpToken(input: { workspaceId: string; tokenId: string; actorId: string; canManageAll: boolean }) {
  const result = getDatabase()
    .prepare(
      `UPDATE workspace_mcp_token SET revoked_at = ?
       WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL
         AND (created_by_user_id = ? OR ? = 1)`,
    )
    .run(new Date().toISOString(), input.tokenId, input.workspaceId, input.actorId, Number(input.canManageAll));
  return result.changes === 1;
}

export function resolveWorkspaceMcpToken(token: string) {
  const tokenHash = hashToken(token);
  const record = getDatabase()
    .prepare(
      `SELECT id, workspace_id AS workspaceId, created_by_user_id AS createdBy,
              scopes_json AS scopesJson, expires_at AS expiresAt, revoked_at AS revokedAt
       FROM workspace_mcp_token WHERE token_hash = ?`,
    )
    .get(tokenHash) as {
      id: string;
      workspaceId: string;
      createdBy: string;
      scopesJson: string;
      expiresAt: string;
      revokedAt: string | null;
    } | undefined;
  if (!record || record.revokedAt || Date.parse(record.expiresAt) <= Date.now()) return null;
  const membership = getDatabase()
    .prepare("SELECT 1 FROM workspace_membership WHERE workspace_id = ? AND user_id = ?")
    .get(record.workspaceId, record.createdBy);
  if (!membership) return null;
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    createdBy: record.createdBy,
    scopes: JSON.parse(record.scopesJson) as McpScope[],
    expiresAt: record.expiresAt,
  };
}
