import { createHash } from "node:crypto";
import { getDatabase } from "../db";
import { allowedEmailDomains } from "./onboarding";
import { projectIconMaxBytes, sniffImageType } from "./project-icons";

export class WorkspaceSettingsError extends Error {}

const domainPattern = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "@Acme.com, plxr.io" → ["acme.com", "plxr.io"]; throws on anything that isn't a domain. */
export function parseEmailDomains(input: string[]) {
  const domains = [...new Set(input.map((domain) => domain.trim().toLowerCase().replace(/^@/, "")).filter(Boolean))];
  const invalid = domains.find((domain) => !domainPattern.test(domain));
  if (invalid) throw new WorkspaceSettingsError(`"${invalid}" isn't an email domain.`);
  if (domains.length > 20) throw new WorkspaceSettingsError("Add up to 20 domains.");
  return domains;
}

export type WorkspaceSettings = {
  id: string;
  name: string;
  /** Domains saved in Settings, or null when the deployment's ASBIR_ALLOWED_EMAIL_DOMAINS applies. */
  allowedEmailDomains: string[] | null;
  /** Domains from the deployment's environment, shown as the default. */
  environmentDomains: string[];
  logoVersion: string | null;
};

export async function getWorkspaceSettings(workspaceId: string): Promise<WorkspaceSettings | null> {
  const row = (await getDatabase()
    .prepare(
      `SELECT workspace.id, workspace.name, workspace.allowed_email_domains AS domains, substr(workspace_logo.sha256, 1, 12) AS logoVersion
       FROM workspace LEFT JOIN workspace_logo ON workspace_logo.workspace_id = workspace.id
       WHERE workspace.id = ?`,
    )
    .get(workspaceId)) as { id: string; name: string; domains: string | null; logoVersion: string | null } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    allowedEmailDomains: row.domains === null ? null : row.domains.split(",").filter(Boolean),
    environmentDomains: allowedEmailDomains(),
    logoVersion: row.logoVersion,
  };
}

export async function updateWorkspaceSettings(workspaceId: string, input: { name?: string; allowedEmailDomains?: string[] | null }) {
  const database = getDatabase();
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name || name.length > 80) throw new WorkspaceSettingsError("Enter a workspace name up to 80 characters.");
    await database.prepare("UPDATE workspace SET name = ? WHERE id = ?").run(name, workspaceId);
  }
  if (input.allowedEmailDomains !== undefined) {
    const domains = input.allowedEmailDomains === null ? null : parseEmailDomains(input.allowedEmailDomains).join(",");
    await database.prepare("UPDATE workspace SET allowed_email_domains = ? WHERE id = ?").run(domains, workspaceId);
  }
  return getWorkspaceSettings(workspaceId);
}

export async function setWorkspaceLogo(workspaceId: string, bytes: Uint8Array, userId: string) {
  if (!bytes.length) throw new WorkspaceSettingsError("Choose an image.");
  if (bytes.length > projectIconMaxBytes) throw new WorkspaceSettingsError("Images can be up to 512 KB.");
  const contentType = sniffImageType(bytes);
  if (!contentType) throw new WorkspaceSettingsError("Use a PNG, JPEG or WebP image.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await getDatabase()
    .prepare(
      `INSERT INTO workspace_logo (workspace_id, content_type, bytes, sha256, updated_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id) DO UPDATE SET content_type = excluded.content_type, bytes = excluded.bytes,
         sha256 = excluded.sha256, updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`,
    )
    .run(workspaceId, contentType, Buffer.from(bytes), sha256, userId, new Date().toISOString());
  return { logoVersion: sha256.slice(0, 12) };
}

export async function getWorkspaceLogo(workspaceId: string) {
  return (await getDatabase()
    .prepare("SELECT content_type AS contentType, bytes, sha256 FROM workspace_logo WHERE workspace_id = ?")
    .get(workspaceId)) as { contentType: string; bytes: Uint8Array; sha256: string } | undefined;
}

export async function deleteWorkspaceLogo(workspaceId: string) {
  await getDatabase().prepare("DELETE FROM workspace_logo WHERE workspace_id = ?").run(workspaceId);
}

export function workspaceLogoUrl(workspaceId: string, version: string | null | undefined) {
  return version ? `/api/workspaces/${encodeURIComponent(workspaceId)}/logo?v=${version}` : null;
}
