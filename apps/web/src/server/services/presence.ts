import { getDatabase } from "../db";

// One write per person per instance every few minutes is plenty for "Last active".
const throttleMs = 5 * 60 * 1000;
const lastWrite = new Map<string, number>();

/** Records that someone is using the app. Never throws and never slows the request down. */
export function notePresence(userId: string | null | undefined) {
  if (!userId) return;
  const now = Date.now();
  if (now - (lastWrite.get(userId) ?? 0) < throttleMs) return;
  lastWrite.set(userId, now);
  if (lastWrite.size > 5000) lastWrite.clear();
  void Promise.resolve()
    .then(() =>
      getDatabase()
        .prepare(
          `INSERT INTO user_presence (user_id, last_seen_at) VALUES (?, now())
           ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now()`,
        )
        .run(userId),
    )
    .catch(() => {
      lastWrite.delete(userId);
    });
}
