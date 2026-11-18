import webpush from "web-push";
import { getDatabase } from "../db";

/**
 * Web push to the installed app (and browsers that allow it). Off until VAPID_PUBLIC_KEY and
 * VAPID_PRIVATE_KEY are set; generate a pair once with `npx web-push generate-vapid-keys`.
 */
export function pushPublicKey() {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

export function isPushEnabled() {
  return Boolean(pushPublicKey() && process.env.VAPID_PRIVATE_KEY?.trim());
}

let configured = false;
function configure() {
  if (configured) return;
  const subject = process.env.VAPID_SUBJECT?.trim() || process.env.BETTER_AUTH_URL?.trim() || "http://localhost:3000";
  webpush.setVapidDetails(subject, pushPublicKey()!, process.env.VAPID_PRIVATE_KEY!.trim());
  configured = true;
}

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

export async function savePushSubscription(userId: string, subscription: PushSubscriptionInput, userAgent: string | null) {
  await getDatabase()
    .prepare(
      `INSERT INTO push_subscription (endpoint, user_id, p256dh, auth, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent`,
    )
    .run(subscription.endpoint, userId, subscription.keys.p256dh, subscription.keys.auth, userAgent?.slice(0, 300) ?? null, new Date().toISOString());
}

export async function deletePushSubscription(userId: string, endpoint: string) {
  await getDatabase().prepare("DELETE FROM push_subscription WHERE endpoint = ? AND user_id = ?").run(endpoint, userId);
}

export async function countPushSubscriptions(userId: string) {
  const row = (await getDatabase().prepare("SELECT COUNT(*)::integer AS total FROM push_subscription WHERE user_id = ?").get(userId)) as { total: number };
  return row.total;
}

export type PushMessage = { title: string; body: string; url: string; tag?: string };

/** Sends to every device of these people. Gone subscriptions (404/410) are removed. Never throws. */
export async function sendPushToEmails(emails: string[], message: PushMessage) {
  if (!isPushEnabled() || !emails.length) return { sent: 0 };
  configure();
  const lowered = [...new Set(emails.map((email) => email.toLowerCase()))];
  const subscriptions = (await getDatabase()
    .prepare(
      `SELECT push_subscription.endpoint, push_subscription.p256dh, push_subscription.auth
       FROM push_subscription JOIN "user" ON "user".id = push_subscription.user_id
       WHERE lower("user".email) IN (${lowered.map(() => "?").join(", ")})`,
    )
    .all(...lowered)) as Array<{ endpoint: string; p256dh: string; auth: string }>;
  const payload = JSON.stringify(message);
  let sent = 0;
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 60 * 60 * 24 });
        sent += 1;
        await getDatabase().prepare("UPDATE push_subscription SET last_success_at = ? WHERE endpoint = ?").run(new Date().toISOString(), subscription.endpoint);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await getDatabase().prepare("DELETE FROM push_subscription WHERE endpoint = ?").run(subscription.endpoint).catch(() => undefined);
        } else {
          console.warn("[push] Could not send:", status ?? error);
        }
      }
    }),
  );
  return { sent };
}
