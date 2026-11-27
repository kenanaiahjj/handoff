import { getDatabase } from "../db";
import { plainCommentText } from "./mentions";
import { screenChangesBetween } from "./review-visibility";

/**
 * Email through Resend (resend.com, free up to 3,000 a month). Off until RESEND_API_KEY and
 * EMAIL_FROM (e.g. `Asbir Handoff <handoff@yourdomain.com>`, on a domain verified in Resend) are set.
 * Always off on Vercel Preview: Preview shares the production database, so it would email real people.
 */
export function isEmailEnabled() {
  if (process.env.VERCEL_ENV === "preview") return false;
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

type EmailFetch = (url: string, init: RequestInit) => Promise<Response>;
export type EmailMessage = { subject: string; heading: string; lines: string[]; quote?: string | null; buttonLabel: string; url: string };

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function appUrl(path: string) {
  return new URL(path, process.env.BETTER_AUTH_URL || "http://localhost:3000").toString();
}

export function renderEmail(message: EmailMessage) {
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1917">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px" cellspacing="0" cellpadding="0"><tr><td>
<p style="margin:0 0 16px;font-size:16px;line-height:1.5;font-weight:600">${escapeHtml(message.heading)}</p>
${message.lines.map((line) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#57534e">${escapeHtml(line)}</p>`).join("\n")}
${message.quote ? `<p style="margin:12px 0 0;padding:10px 14px;border-left:3px solid #d6d3d1;font-size:14px;line-height:1.5;color:#292524;white-space:pre-wrap">${escapeHtml(message.quote)}</p>` : ""}
<p style="margin:24px 0 0"><a href="${escapeHtml(message.url)}" style="display:inline-block;background:#1c1917;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">${escapeHtml(message.buttonLabel)}</a></p>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#a8a29e">You get this because you're on this project's team in Asbir Handoff.</p>
</td></tr></table></body></html>`;
  const text = [message.heading, ...message.lines, message.quote ? `\n"${message.quote}"` : "", `\n${message.buttonLabel}: ${message.url}`]
    .filter(Boolean)
    .join("\n");
  return { html, text };
}

/** One email per person (nobody sees the others' addresses), sent in a single Resend batch call. Never throws. */
export async function sendEmails(emails: string[], message: EmailMessage, fetcher: EmailFetch = fetch) {
  const recipients = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (!isEmailEnabled() || !recipients.length) return { sent: 0 };
  const { html, text } = renderEmail(message);
  const from = process.env.EMAIL_FROM!.trim();
  let sent = 0;
  // Resend's batch endpoint takes up to 100 emails per call.
  for (let start = 0; start < recipients.length; start += 100) {
    const chunk = recipients.slice(start, start + 100);
    try {
      const response = await fetcher("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify(chunk.map((to) => ({ from, to: [to], subject: message.subject, html, text }))),
      });
      if (response.ok) sent += chunk.length;
      else console.warn(`[email] Resend refused the batch (${response.status}):`, await response.text().catch(() => ""));
    } catch (error) {
      console.warn("[email] Could not reach Resend:", error);
    }
  }
  return { sent };
}

/** The project's team: everyone added to the project, plus its PD in charge. Lowercased. */
export async function projectTeamEmails(handoffId: string) {
  const rows = (await getDatabase()
    .prepare(
      `SELECT project_member.email FROM handoff
         JOIN project_member ON project_member.project_id = handoff.project_id AND project_member.workspace_id = handoff.workspace_id
         WHERE handoff.id = ?
       UNION
       SELECT "user".email FROM handoff JOIN project ON project.id = handoff.project_id
         JOIN "user" ON "user".id = project.pd_in_charge_user_id WHERE handoff.id = ?`,
    )
    .all(handoffId, handoffId)) as Array<{ email: string }>;
  return [...new Set(rows.map((row) => row.email.toLowerCase()))];
}

async function userEmail(userId: string | null | undefined) {
  if (!userId) return null;
  const row = (await getDatabase().prepare('SELECT lower(email) AS email FROM "user" WHERE id = ?').get(userId)) as { email: string } | undefined;
  return row?.email ?? null;
}

/** Emails the project team about a new version of one of its handoffs — not the person who published it. */
export async function emailNewVersion(input: { workspaceId: string; handoffId: string; versionId: string; createdBy: string }, fetcher?: EmailFetch) {
  if (!isEmailEnabled()) return { sent: 0 };
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
    .prepare(`SELECT id FROM handoff_version WHERE handoff_id = ? AND id <> ? ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(input.handoffId, input.versionId)) as { id: string } | undefined;

  const base = `/projects/${details.projectId}/handoffs/${input.handoffId}`;
  let summary: string | null = null;
  let url = appUrl(`${base}?versionId=${input.versionId}`);
  if (previous) {
    const changes = await screenChangesBetween(previous.id, input.versionId);
    const parts = [
      changes.changed ? `${changes.changed} ${changes.changed === 1 ? "screen" : "screens"} changed` : "",
      changes.added ? `${changes.added} new` : "",
      changes.removed ? `${changes.removed} removed` : "",
    ].filter(Boolean);
    summary = parts.length ? parts.join(" · ") : null;
    url = appUrl(`${base}?compare=1&compareFrom=${previous.id}&compareTo=${input.versionId}&versionId=${input.versionId}`);
  }

  const publisherEmail = await userEmail(input.createdBy);
  const recipients = (await projectTeamEmails(input.handoffId)).filter((email) => email !== publisherEmail);
  const who = details.publisher ?? "Someone";
  return sendEmails(
    recipients,
    {
      subject: `${details.handoffName} ${details.versionLabel} is ready`,
      heading: `${who} published version ${details.versionLabel} of ${details.handoffName}`,
      lines: [`Project: ${details.projectName}`, ...(summary ? [summary] : [])],
      buttonLabel: previous ? "Review changes" : "Open handoff",
      url,
    },
    fetcher,
  );
}

/** Emails the project team about a new comment or reply — not its author. */
export async function emailNewComment(
  input: { handoffId: string; versionId: string; commentId: string; body: string; authorId?: string | null; authorEmail?: string | null; isReply: boolean },
  fetcher?: EmailFetch,
) {
  if (!isEmailEnabled()) return { sent: 0 };
  const details = (await getDatabase()
    .prepare(
      `SELECT handoff.name AS handoffName, handoff.project_id AS projectId, project.name AS projectName,
              (SELECT name FROM "user" WHERE id = ?) AS author
       FROM handoff JOIN project ON project.id = handoff.project_id WHERE handoff.id = ?`,
    )
    .get(input.authorId ?? null, input.handoffId)) as { handoffName: string; projectId: string; projectName: string; author: string | null } | undefined;
  if (!details) return { sent: 0 };
  const authorEmail = input.authorEmail?.toLowerCase() ?? (await userEmail(input.authorId));
  const recipients = (await projectTeamEmails(input.handoffId)).filter((email) => email !== authorEmail);
  const text = plainCommentText(input.body).replace(/\s+/g, " ").trim();
  const excerpt = text.length > 500 ? `${text.slice(0, 499)}…` : text;
  const who = details.author ?? authorEmail ?? "Someone";
  return sendEmails(
    recipients,
    {
      subject: `${who} ${input.isReply ? "replied" : "commented"} on ${details.handoffName}`,
      heading: `${who} ${input.isReply ? "replied to a comment" : "commented"} on ${details.handoffName}`,
      lines: [`Project: ${details.projectName}`],
      quote: excerpt,
      buttonLabel: "Open comment",
      url: appUrl(`/projects/${details.projectId}/handoffs/${input.handoffId}?versionId=${input.versionId}&comment=${input.commentId}`),
    },
    fetcher,
  );
}
