import { getDatabase } from "../db";
import { listOpenMentions } from "./mentions";
import { visibleHandoffIds } from "./review-visibility";
import { isSlackEnabled, sendSlackDigest } from "./slack";
import { listWorkspaceActivity } from "./workspace-activity";

export type DigestLine = { text: string; path: string };

export type Digest = {
  email: string;
  name: string | null;
  openMentions: number;
  newVersions: number;
};

/**
 * One person's week: mentions still waiting on them and new versions in the last 7 days of handoffs
 * they can see. Empty weeks return null.
 */
export async function buildDigest(workspaceId: string, member: { id: string; email: string; name: string | null; role: string }, now = new Date()): Promise<Digest | null> {
  const viewer = { id: member.id, email: member.email, role: member.role };
  const visible = await visibleHandoffIds(workspaceId, viewer);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [mentions, activity] = await Promise.all([
    listOpenMentions(member.id, workspaceId, viewer),
    listWorkspaceActivity(workspaceId, visible, 200),
  ]);
  const digest: Digest = {
    email: member.email,
    name: member.name,
    openMentions: mentions.length,
    newVersions: activity.filter((event) => event.kind === "version" && event.at >= weekAgo).length,
  };
  return digest.openMentions || digest.newVersions ? digest : null;
}

/** Sends the weekly Slack digest to everyone who hasn't turned notifications off. */
export async function sendWeeklyDigests(now = new Date()) {
  if (!isSlackEnabled()) return { sent: 0, skipped: "Slack isn't set up (SLACK_BOT_TOKEN)." };
  const members = (await getDatabase()
    .prepare(
      `SELECT workspace_membership.workspace_id AS workspaceId, "user".id, "user".email, "user".name, workspace_membership.role
       FROM workspace_membership
       JOIN "user" ON "user".id = workspace_membership.user_id
       LEFT JOIN notification_preference ON notification_preference.user_id = "user".id
       WHERE COALESCE(notification_preference.slack, 'all') <> 'off'`,
    )
    .all()) as Array<{ workspaceId: string; id: string; email: string; name: string | null; role: string }>;
  let sent = 0;
  for (const member of members) {
    try {
      const digest = await buildDigest(member.workspaceId, member, now);
      if (digest && (await sendSlackDigest(digest)).sent) sent += 1;
    } catch (error) {
      console.warn("[digest] Could not build or send a digest:", error);
    }
  }
  return { sent };
}
