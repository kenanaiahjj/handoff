export const dayMs = 24 * 60 * 60 * 1000;

/** "Today", "3 days ago", "Mar 4": how long since someone last used the app. */
export function formatLastActive(iso: string | null, now = Date.now()) {
  if (!iso) return "Never signed in";
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "Unknown";
  const days = Math.floor((now - time) / dayMs);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric", year: days > 330 ? "numeric" : undefined });
}
