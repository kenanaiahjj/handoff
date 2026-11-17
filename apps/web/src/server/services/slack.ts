import { getDatabase } from "../db";
import { plainCommentText } from "./mentions";
import { filterBySlackPreference } from "./notification-preferences";
import { screenChangesBetween } from "./review-visibility";

/**
 * Slack direct messages from the "Asbir Handoff" Slack app. Off until SLACK_BOT_TOKEN is set.
 * The app needs the scopes chat:write, users:read and users:read.email; people are matched to
 * Slack by their email address.
 */
export function isSlackEnabled() {
  return Boolean(process.env.SLACK_BOT_TOKEN?.trim());
}

type SlackFetch = (url: string, init: RequestInit) => Promise<Response>;
type SlackMessage = { text: string; blocks: unknown[] };

const slackUserIds = new Map<string, string | null>();

async function slackApi(fetcher: SlackFetch, method: string, init: { query?: Record<string, string>; body?: unknown }) {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
  const response = await fetcher(url.toString(), {
    method: init.body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN?.trim()}`,
      ...(init.body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return (await response.json()) as { ok: boolean; error?: string; user?: { id: string } };
}

async function slackUserId(fetcher: SlackFetch, email: string) {
  const key = email.toLowerCase();
  if (slackUserIds.has(key)) return slackUserIds.get(key) ?? null;
  const result = await slackApi(fetcher, "users.lookupByEmail", { query: { email: key } });
  const id = result.ok && result.user ? result.user.id : null;
  slackUserIds.set(key, id);
  return id;
}

/** Sends one DM per email that has a Slack account; people without one are skipped quietly. */
export async function sendSlackDirectMessages(emails: string[], message: SlackMessage, fetcher: SlackFetch = fetch) {
  if (!isSlackEnabled()) return { sent: 0 };
  let sent = 0;
  for (const email of [...new Set(emails.map((entry) => entry.toLowerCase()))]) {
    try {
      const channel = await slackUserId(fetcher, email);
      if (!channel) continue;
      const result = await slackApi(fetcher, "chat.postMessage", { body: { channel, text: message.text, blocks: message.blocks, unfurl_links: false } });
      if (result.ok) sent += 1;
      else console.warn(`[slack] Could not message ${email}: ${result.error}`);
    } catch (error) {
      console.warn(`[slack] Could not message ${email}:`, error);
    }
  }
  return { sent };
}

function appUrl(path: string) {
  return new URL(path, process.env.BETTER_AUTH_URL || "http://localhost:3000").toString();
}

function messageWithButton(text: string, detail: string | null, buttonLabel: string, url: string): SlackMessage {
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: detail ? `${text}\n${detail}` : text } },
      { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: buttonLabel }, url, style: "primary" }] },
    ],
  };
}

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Who hears about a new version: people the handoff is shared with, the project's PD, and anyone who
 * pinned the project — never the person who published it.
 */
export async function newVersionRecipients(input: { workspaceId: string; handoffId: string; createdBy: string }) {
  const rows = (await getDatabase()
    .prepare(
      `SELECT email FROM handoff_invite
         WHERE handoff_id = ? AND workspace_id = ? AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
       UNION
       SELECT "user".email FROM handoff JOIN project ON project.id = handoff.project_id
         JOIN "user" ON "user".id = project.pd_in_charge_user_id WHERE handoff.id = ?
       UNION
       SELECT "user".email FROM handoff
         JOIN viewer_pin ON viewer_pin.kind = 'project' AND viewer_pin.target_id = handoff.project_id
         JOIN workspace_membership ON workspace_membership.user_id = viewer_pin.user_id AND workspace_membership.workspace_id = handoff.workspace_id
         JOIN "user" ON "user".id = viewer_pin.user_id WHERE handoff.id = ?`,
    )
    .all(input.handoffId, input.workspaceId, new Date().toISOString(), input.handoffId, input.handoffId)) as Array<{ email: string }>;
  const publisher = (await getDatabase().prepare('SELECT lower(email) AS email FROM "user" WHERE id = ?').get(input.createdBy)) as { email: string } | undefined;
  return rows.map((row) => row.email.toLowerCase()).filter((email) => email !== publisher?.email);
}

/** DMs everyone following a handoff about its new version, with a button straight into the comparison. */
export async function notifyNewVersion(input: { workspaceId: string; handoffId: string; versionId: string; createdBy: string }, fetcher?: SlackFetch) {
  if (!isSlackEnabled()) return { sent: 0 };
  const database = getDatabase();
  const details = (await database
    .prepare(
      `SELECT handoff.name AS handoffName, handoff.project_id AS projectId, project.name AS projectName,
              handoff_version.version_label AS versionLabel, "user".name AS publisher
       FROM handoff_version
       JOIN handoff ON handoff.id = handoff_version.handoff_id
       JOIN project ON project.id = handoff.project_id
       LEFT JOIN "user" ON "user".id = handoff_version.created_by_user_id
       WHERE handoff_version.id = ?`,
    )
    .get(input.versionId)) as { handoffName: string; projectId: string; projectName: string; versionLabel: string; publisher: string | null } | undefined;
  if (!details) return { sent: 0 };
  const previous = (await database
    .prepare(
      `SELECT id FROM handoff_version WHERE handoff_id = ? AND id <> ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(input.handoffId, input.versionId)) as { id: string } | undefined;

  const base = `/workspace/${input.workspaceId}/projects/${details.projectId}/handoffs/${input.handoffId}`;
  let detail: string | null = null;
  let url = appUrl(`${base}?versionId=${input.versionId}`);
  if (previous) {
    const changes = (await screenChangesBetween(previous.id, input.versionId));
    const parts = [
      changes.changed ? `${changes.changed} ${changes.changed === 1 ? "screen" : "screens"} changed` : "",
      changes.added ? `${changes.added} new` : "",
      changes.removed ? `${changes.removed} removed` : "",
    ].filter(Boolean);
    detail = parts.length ? parts.join(" · ") : null;
    url = appUrl(`${base}?compare=1&compareFrom=${previous.id}&compareTo=${input.versionId}&versionId=${input.versionId}`);
  }
  const text = `*${escape(details.publisher ?? "Someone")}* published version *${escape(details.versionLabel)}* of *${escape(details.handoffName)}* in ${escape(details.projectName)}.`;
  return sendSlackDirectMessages(
    (await filterBySlackPreference((await newVersionRecipients(input)), "version")),
    messageWithButton(text, detail, previous ? "Review changes" : "Open handoff", url),
    fetcher,
  );
}

/** DMs each person mentioned in a comment, with a button that opens the thread. */
export async function notifyMentions(
  input: { workspaceId: string; handoffId: string; versionId: string; commentId: string; authorId: string; body: string; mentioned: Array<{ email: string }> },
  fetcher?: SlackFetch,
) {
  if (!isSlackEnabled() || !input.mentioned.length) return { sent: 0 };
  const details = (await getDatabase()
    .prepare(
      `SELECT handoff.name AS handoffName, handoff.project_id AS projectId, project.name AS projectName,
              (SELECT name FROM "user" WHERE id = ?) AS author
       FROM handoff JOIN project ON project.id = handoff.project_id WHERE handoff.id = ?`,
    )
    .get(input.authorId, input.handoffId)) as { handoffName: string; projectId: string; projectName: string; author: string | null } | undefined;
  if (!details) return { sent: 0 };
  const text = plainCommentText(input.body).replace(/\s+/g, " ").trim();
  const excerpt = text.length > 280 ? `${text.slice(0, 279)}…` : text;
  return sendSlackDirectMessages(
    (await filterBySlackPreference(input.mentioned.map((person) => person.email), "mention")),
    messageWithButton(
      `*${escape(details.author ?? "Someone")}* mentioned you in *${escape(details.handoffName)}* · ${escape(details.projectName)}`,
      `> ${escape(excerpt)}`,
      "Open comment",
      appUrl(`/workspace/${input.workspaceId}/projects/${details.projectId}/handoffs/${input.handoffId}?versionId=${input.versionId}&comment=${input.commentId}`),
    ),
    fetcher,
  );
}
