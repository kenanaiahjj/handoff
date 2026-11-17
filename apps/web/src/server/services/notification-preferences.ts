import { getDatabase } from "../db";

export const slackPreferences = ["all", "mentions", "off"] as const;
export type SlackPreference = (typeof slackPreferences)[number];

export async function getSlackPreference(userId: string): Promise<SlackPreference> {
  const row = (await getDatabase().prepare("SELECT slack FROM notification_preference WHERE user_id = ?").get(userId)) as { slack: SlackPreference } | undefined;
  return row?.slack ?? "all";
}

export async function setSlackPreference(userId: string, slack: SlackPreference) {
  (await getDatabase()
    .prepare(
      `INSERT INTO notification_preference (user_id, slack, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET slack = excluded.slack, updated_at = excluded.updated_at`,
    )
    .run(userId, slack, new Date().toISOString()));
}

/**
 * Drops the emails whose owners turned this kind of Slack message off. People without an account
 * yet (invited by email only) keep the default: everything.
 */
export async function filterBySlackPreference(emails: string[], kind: "version" | "mention") {
  if (!emails.length) return emails;
  const placeholders = emails.map(() => "?").join(", ");
  const rows = (await getDatabase()
    .prepare(
      `SELECT lower("user".email) AS email, notification_preference.slack
       FROM "user" JOIN notification_preference ON notification_preference.user_id = "user".id
       WHERE lower("user".email) IN (${placeholders})`,
    )
    .all(...emails.map((email) => email.toLowerCase()))) as Array<{ email: string; slack: SlackPreference }>;
  const preference = new Map(rows.map((row) => [row.email, row.slack]));
  return emails.filter((email) => {
    const choice = preference.get(email.toLowerCase()) ?? "all";
    return choice === "all" || (choice === "mentions" && kind === "mention");
  });
}
