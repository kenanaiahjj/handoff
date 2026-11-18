import { getDatabase } from "../db";
import { visibleHandoffIds } from "./review-visibility";

/** Mentions are saved in comment text as "@[Name](user:<id>)" and shown as "@Name". */
export const mentionPattern = /@\[([^\]\n]{1,80})\]\(user:([A-Za-z0-9_-]{1,64})\)/g;

export function mentionedUserIds(body: string) {
  return [...new Set([...body.matchAll(mentionPattern)].map((match) => match[2]))];
}

/** The comment text with mentions shown as "@Name", for previews and notifications. */
export function plainCommentText(body: string) {
  return body.replace(mentionPattern, "@$1");
}

export type Mentionable = { id: string; name: string; email: string };

/** Team members who can open this handoff, so a mention never points at someone who can't see it. */
export async function listMentionables(workspaceId: string, handoffId: string): Promise<Mentionable[]> {
  const members = (await getDatabase()
    .prepare(
      `SELECT "user".id, "user".name, "user".email, workspace_membership.role
       FROM workspace_membership JOIN "user" ON "user".id = workspace_membership.user_id
       WHERE workspace_membership.workspace_id = ?
       ORDER BY lower("user".name) COLLATE "C"`,
    )
    .all(workspaceId)) as Array<Mentionable & { role: string }>;
  const visibility = await Promise.all(members.map(async (member) => {
    const visible = await visibleHandoffIds(workspaceId, member);
    return { member, visible };
  }));
  return visibility
    .filter(({ visible }) => !visible || visible.has(handoffId))
    .map(({ member }) => member)
    .map(({ id, name, email }) => ({ id, name, email }));
}

/**
 * Records who a new comment mentions (only people who can see the handoff), and closes the author's
 * own open mentions in this thread, since replying answers them. Returns the people newly mentioned.
 */
export async function recordCommentMentions(input: {
  workspaceId: string;
  handoffId: string;
  commentId: string;
  threadId: string;
  authorId: string;
  body: string;
}) {
  const database = getDatabase();
  const now = new Date().toISOString();
  const allowed = new Map((await listMentionables(input.workspaceId, input.handoffId)).map((person) => [person.id, person]));
  const mentioned = mentionedUserIds(input.body)
    .filter((id) => id !== input.authorId)
    .map((id) => allowed.get(id))
    .filter((person): person is Mentionable => Boolean(person));
  await database.transaction(async () => {
    const insert = database.prepare(
      `INSERT INTO comment_mention
        (comment_id, user_id, workspace_id, handoff_id, thread_id, mentioned_by_user_id, created_at, done_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT DO NOTHING`,
    );
    for (const person of mentioned) {
      await insert.run(input.commentId, person.id, input.workspaceId, input.handoffId, input.threadId, input.authorId, now);
    }
    (await database
      .prepare("UPDATE comment_mention SET done_at = ? WHERE user_id = ? AND thread_id = ? AND done_at IS NULL")
      .run(now, input.authorId, input.threadId));
  })();
  return mentioned;
}

export type OpenMention = {
  commentId: string;
  threadId: string;
  handoffId: string;
  handoffName: string;
  projectId: string;
  projectName: string;
  workspaceId: string;
  versionId: string;
  frameId: string;
  authorName: string;
  authorImage: string | null;
  excerpt: string;
  createdAt: string;
};

/** Mentions waiting on this person: not done, not replied to, and the thread still open. */
export async function listOpenMentions(userId: string, workspaceId: string, viewer: { id: string; email: string; role: string }): Promise<OpenMention[]> {
  const rows = (await getDatabase()
    .prepare(
      `SELECT comment_mention.comment_id AS commentId, comment_mention.thread_id AS threadId,
              comment_mention.handoff_id AS handoffId, handoff.name AS handoffName,
              project.id AS projectId, project.name AS projectName, comment_mention.workspace_id AS workspaceId,
              handoff_comment.handoff_version_id AS versionId, handoff_comment.frame_id AS frameId,
              COALESCE(author.name, handoff_comment.author_label, 'Someone') AS authorName, author.image AS authorImage,
              handoff_comment.body, comment_mention.created_at AS createdAt
       FROM comment_mention
       JOIN handoff_comment ON handoff_comment.id = comment_mention.comment_id
       JOIN handoff_comment AS thread ON thread.id = comment_mention.thread_id
       JOIN handoff ON handoff.id = comment_mention.handoff_id
       JOIN project ON project.id = handoff.project_id
       LEFT JOIN "user" AS author ON author.id = handoff_comment.created_by_user_id
       WHERE comment_mention.user_id = ? AND comment_mention.workspace_id = ?
         AND comment_mention.done_at IS NULL AND thread.resolved_at IS NULL
       ORDER BY comment_mention.created_at DESC
       LIMIT 50`,
    )
    .all(userId, workspaceId)) as Array<Omit<OpenMention, "excerpt"> & { body: string }>;
  const visible = (await visibleHandoffIds(workspaceId, viewer));
  return rows
    .filter((row) => !visible || visible.has(row.handoffId))
    .map(({ body, ...row }) => {
      const text = plainCommentText(body).replace(/\s+/g, " ").trim();
      return { ...row, excerpt: text.length > 140 ? `${text.slice(0, 139)}…` : text };
    });
}

export async function markMentionDone(userId: string, commentId: string) {
  return (await getDatabase()
    .prepare("UPDATE comment_mention SET done_at = ? WHERE user_id = ? AND comment_id = ? AND done_at IS NULL")
    .run(new Date().toISOString(), userId, commentId)).changes > 0;
}
