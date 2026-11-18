import { createHash } from "node:crypto";
import { getDatabase } from "../db";

export const projectIconTypes = ["image/png", "image/jpeg", "image/webp"] as const;
export type ProjectIconType = (typeof projectIconTypes)[number];
/** The browser resizes to 256 × 256 before uploading, so this is generous. */
export const projectIconMaxBytes = 512 * 1024;

export class ProjectIconError extends Error {}

/** Checks the file really is the image type it claims (no SVG: it can carry scripts). */
export function sniffImageType(bytes: Uint8Array): ProjectIconType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function setProjectIcon(input: { projectId: string; bytes: Uint8Array; userId: string }) {
  if (!input.bytes.length) throw new ProjectIconError("Choose an image.");
  if (input.bytes.length > projectIconMaxBytes) throw new ProjectIconError("Images can be up to 512 KB.");
  const contentType = sniffImageType(input.bytes);
  if (!contentType) throw new ProjectIconError("Use a PNG, JPEG or WebP image.");
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  (await getDatabase()
    .prepare(
      `INSERT INTO project_icon (project_id, content_type, bytes, sha256, updated_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET content_type = excluded.content_type, bytes = excluded.bytes,
         sha256 = excluded.sha256, updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`,
    )
    .run(input.projectId, contentType, Buffer.from(input.bytes), sha256, input.userId, new Date().toISOString()));
  return { iconVersion: sha256.slice(0, 12) };
}

export async function getProjectIcon(projectId: string) {
  const row = (await getDatabase()
    .prepare("SELECT content_type AS contentType, bytes, sha256 FROM project_icon WHERE project_id = ?")
    .get(projectId)) as { contentType: ProjectIconType; bytes: Buffer; sha256: string } | undefined;
  return row ?? null;
}

export async function deleteProjectIcon(projectId: string) {
  return (await getDatabase().prepare("DELETE FROM project_icon WHERE project_id = ?").run(projectId)).changes > 0;
}

/** Short content fingerprint per project that has an icon; it goes in the URL so caches stay correct. */
export async function projectIconVersions(workspaceId: string) {
  const rows = (await getDatabase()
    .prepare(
      `SELECT project_icon.project_id AS projectId, substr(project_icon.sha256, 1, 12) AS iconVersion
       FROM project_icon JOIN project ON project.id = project_icon.project_id
       WHERE project.workspace_id = ?`,
    )
    .all(workspaceId)) as Array<{ projectId: string; iconVersion: string }>;
  return Object.fromEntries(rows.map((row) => [row.projectId, row.iconVersion])) as Record<string, string>;
}

export function projectIconUrl(workspaceId: string, projectId: string, iconVersion: string | null | undefined) {
  return iconVersion
    ? `/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/icon?v=${iconVersion}`
    : null;
}
