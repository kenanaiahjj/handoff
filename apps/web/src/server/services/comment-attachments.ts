import { randomUUID } from "node:crypto";
import { getDatabase } from "../db";
import { sniffImageType } from "./project-icons";

/** The browser shrinks screenshots before uploading; this leaves room under the 4.5 MB request limit. */
export const commentAttachmentMaxBytes = 3 * 1024 * 1024;
export const commentAttachmentsPerComment = 4;

export class CommentAttachmentError extends Error {}

/**
 * The comment_attachment table arrives with a migration that production applies by hand. Until it
 * exists, comments load without images and uploads say so, instead of the comment list failing.
 */
function isMissingTable(error: unknown) {
  return (error as { code?: string } | null)?.code === "42P01";
}

type AttachmentType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

function sniff(bytes: Uint8Array): AttachmentType | null {
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)).startsWith("GIF8")) return "image/gif";
  return sniffImageType(bytes);
}

export type CommentAttachment = { id: string; contentType: AttachmentType; width: number | null; height: number | null };

export async function createCommentAttachment(input: {
  workspaceId: string;
  versionId: string;
  bytes: Uint8Array;
  width: number | null;
  height: number | null;
  createdBy: string | null;
}): Promise<CommentAttachment> {
  if (!input.bytes.length) throw new CommentAttachmentError("Choose an image.");
  if (input.bytes.length > commentAttachmentMaxBytes) throw new CommentAttachmentError("Images can be up to 3 MB.");
  const contentType = sniff(input.bytes);
  if (!contentType) throw new CommentAttachmentError("Use a PNG, JPEG, WebP or GIF image.");
  const id = randomUUID();
  const dimension = (value: number | null) => (value && Number.isFinite(value) && value > 0 ? Math.round(value) : null);
  try {
    (await getDatabase()
    .prepare(
      `INSERT INTO comment_attachment
        (id, workspace_id, handoff_version_id, comment_id, content_type, bytes, size_bytes, width, height, created_by_user_id, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.workspaceId, input.versionId, contentType, Buffer.from(input.bytes), input.bytes.length, dimension(input.width), dimension(input.height), input.createdBy, new Date().toISOString()));
  } catch (error) {
    if (isMissingTable(error)) throw new CommentAttachmentError("Image attachments aren't switched on here yet.");
    throw error;
  }
  return { id, contentType, width: dimension(input.width), height: dimension(input.height) };
}

/** Links uploaded images to the comment just posted. Only unclaimed uploads from the same version count. */
export async function attachToComment(input: { workspaceId: string; versionId: string; commentId: string; attachmentIds: string[] }) {
  const ids = [...new Set(input.attachmentIds)].slice(0, commentAttachmentsPerComment);
  const database = getDatabase();
  for (const id of ids) {
    (await database
      .prepare(
        `UPDATE comment_attachment SET comment_id = ?
         WHERE id = ? AND workspace_id = ? AND handoff_version_id = ? AND comment_id IS NULL`,
      )
      .run(input.commentId, id, input.workspaceId, input.versionId));
  }
}

export async function listCommentAttachments(workspaceId: string, versionId: string) {
  let rows: Array<CommentAttachment & { commentId: string }>;
  try {
    rows = (await getDatabase()
    .prepare(
      `SELECT id, comment_id AS commentId, content_type AS contentType, width, height
       FROM comment_attachment
       WHERE workspace_id = ? AND handoff_version_id = ? AND comment_id IS NOT NULL
       ORDER BY created_at ASC`,
    )
    .all(workspaceId, versionId)) as Array<CommentAttachment & { commentId: string }>;
  } catch (error) {
    if (isMissingTable(error)) return new Map<string, CommentAttachment[]>();
    throw error;
  }
  const byComment = new Map<string, CommentAttachment[]>();
  for (const { commentId, ...attachment } of rows) byComment.set(commentId, [...(byComment.get(commentId) ?? []), attachment]);
  return byComment;
}

/** Comments with their images, for the comment list endpoints. */
export async function withAttachments<T extends { id: string }>(workspaceId: string, versionId: string, comments: T[]) {
  const attachments = await listCommentAttachments(workspaceId, versionId);
  return comments.map((comment) => ({ ...comment, attachments: attachments.get(comment.id) ?? [] }));
}

export async function getCommentAttachment(workspaceId: string, versionId: string, attachmentId: string) {
  const row = (await getDatabase()
    .prepare(
      `SELECT content_type AS contentType, bytes FROM comment_attachment
       WHERE id = ? AND workspace_id = ? AND handoff_version_id = ?`,
    )
    .get(attachmentId, workspaceId, versionId)) as { contentType: AttachmentType; bytes: Buffer | Uint8Array } | undefined;
  return row ?? null;
}

export function attachmentResponse(row: { contentType: string; bytes: Buffer | Uint8Array }) {
  return new Response(new Uint8Array(row.bytes), {
    headers: {
      "Content-Type": row.contentType,
      // Attachments never change once uploaded; the id is the cache key.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

export function dimensionFromHeader(value: string | null) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
