type FilterableComment = {
  id: string;
  parentCommentId: string | null;
  createdBy: string | null;
  body: string;
  resolvedAt: string | null;
  frameId: string;
};

/** Whose threads the comment list, the pins and N / Shift+N show. */
export type CommentFilter = "all" | "mine" | "mentions";

export const commentFilterLabels: Record<CommentFilter, string> = {
  all: "Everyone",
  mine: "Mine",
  mentions: "Mentions me",
};

/**
 * Ids of the threads (by their first comment) that pass the filter. "Mine" is threads you started or
 * replied in; "Mentions me" is threads where someone @mentioned you. Null means every thread.
 */
export function visibleThreadIds(comments: readonly FilterableComment[], filter: CommentFilter, viewerId: string | null): Set<string> | null {
  if (filter === "all" || !viewerId) return null;
  const mentionToken = `](user:${viewerId})`;
  const ids = new Set<string>();
  for (const comment of comments) {
    const rootId = comment.parentCommentId ?? comment.id;
    if (filter === "mine" ? comment.createdBy === viewerId : comment.body.includes(mentionToken)) ids.add(rootId);
  }
  return ids;
}

/**
 * The open thread after (or before) the current one, in the order the list shows them, wrapping
 * around. With no current thread, the first (or last).
 */
export function stepOpenThread<Comment extends FilterableComment>(
  comments: readonly Comment[],
  currentId: string | null,
  direction: 1 | -1,
  visible: ReadonlySet<string> | null,
): Comment | null {
  const open = comments.filter((comment) => comment.parentCommentId === null && !comment.resolvedAt && (!visible || visible.has(comment.id)));
  if (!open.length) return null;
  const index = currentId ? open.findIndex((comment) => comment.id === currentId) : -1;
  if (index === -1) return direction === 1 ? open[0] : open[open.length - 1];
  return open[(index + direction + open.length) % open.length];
}
