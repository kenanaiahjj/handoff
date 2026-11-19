import { getDatabase } from "../db";
import { listOpenMentions } from "./mentions";
import { canSeeWholeWorkspace, visibleHandoffIds } from "./review-visibility";
import { isSlackEnabled, sendSlackDigest } from "./slack";
import { listStaleHandoffs, listWorkspaceActivity } from "./workspace-activity";

export type DigestLine = { text: string; path: string };

export type Digest = {
  email: string;
  name: string | null;
  openMentions: number;
  inReview: Array<{ name: string; path: string }>;
  stale: Array<{ name: string; path: string; days: number }>;
  newVersions: number;
};

/**
 * One person's week: mentions still waiting on them, handoffs in review they can see, new versions
 * in the last 7 days, and (for owners and designers) handoffs going stale. Empty weeks return null.
 */
export async function buildDigest(workspaceId: string, member: { id: string; email: string; name: string | null; role: string }, now = new Date()): Promise<Digest | null> {
  const viewer = { id: member.id, email: member.email, role: member.role };
  const visible = await visibleHandoffIds(workspaceId, viewer);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [mentions, inReview, stale, activity] = await Promise.all([
    listOpenMentions(member.id, workspaceId, viewer),
    getDatabase()
      .prepare(
        `SELECT handoff.id, handoff.name, handoff.project_id AS projectId FROM handoff
         WHERE handoff.workspace_id = ? AND handoff.review_status = 'in_review' ORDER BY handoff.review_status_at DESC NULLS LAST LIMIT 20`,
      )
      .all(workspaceId) as Promise<Array<{ id: string; name: string; projectId: string }>>,
    canSeeWholeWorkspace(member.role) ? listStaleHandoffs(workspaceId, null, now) : Promise.resolve([]),
    listWorkspaceActivity(workspaceId, visible, 200),
  ]);
  const base = "";
  const digest: Digest = {
    email: member.email,
    name: member.name,
    openMentions: mentions.length,
    inReview: inReview.filter((handoff) => !visible || visible.has(handoff.id)).slice(0, 5).map((handoff) => ({ name: handoff.name, path: `${base}/projects/${handoff.projectId}/handoffs/${handoff.id}` })),
    stale: stale.slice(0, 5).map((handoff) => ({
      name: handoff.handoffName,
      path: `${base}/projects/${handoff.projectId}/handoffs/${handoff.handoffId}`,
      days: Math.floor((now.getTime() - new Date(handoff.lastActivityAt).getTime()) / 86_400_000),
    })),
    newVersions: activity.filter((event) => event.kind === "version" && event.at >= weekAgo).length,
  };
  return digest.openMentions || digest.inReview.length || digest.stale.length || digest.newVersions ? digest : null;
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
