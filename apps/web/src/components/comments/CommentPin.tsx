export type HandoffInviteRole = "pd" | "qa" | "dev" | "exec";

export type CommentIdentity = {
  label: string;
  role: HandoffInviteRole;
};

export type HandoffComment = {
  id: string;
  frameId: string;
  sourceNodeId: string | null;
  x: number | null;
  y: number | null;
  parentCommentId: string | null;
  body: string;
  resolvedAt: string | null;
  createdBy: string | null;
  authorName: string;
  /** Photo of the signed-in author; null for guests and people without one. */
  authorImage?: string | null;
  authorRole: HandoffInviteRole | null;
  createdAt: string;
  /** Images posted with the comment, served from the comments endpoint. */
  attachments?: CommentAttachment[];
};

export type CommentAttachment = { id: string; contentType: string; width: number | null; height: number | null };

type CommentPinProps = {
  comment: HandoffComment;
  index: number;
  inverseScale: number;
  selected: boolean;
  onSelect: (commentId: string) => void;
};

export function CommentPin({ comment, index, inverseScale, selected, onSelect }: CommentPinProps) {
  if (comment.x === null || comment.y === null) return null;
  const author = comment.authorRole ? `${comment.authorName} · ${comment.authorRole.toUpperCase()}` : comment.authorName;

  return (
    <button
      aria-label={`Comment ${index + 1} by ${author}: ${comment.body}${comment.resolvedAt ? ". Resolved" : ". Open"}`}
      aria-pressed={selected}
      className={`comment-pin absolute z-30 grid size-7 place-items-center rounded-full border font-mono text-[10px] font-medium tabular-nums transition-[scale,box-shadow] duration-150 hover:scale-110 ${selected ? "scale-125" : ""}`}
      onClick={() => onSelect(comment.id)}
      data-resolved={comment.resolvedAt ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      style={{
        left: comment.x - 14 * inverseScale,
        top: comment.y - 14 * inverseScale,
        transform: `scale(${inverseScale})`,
        transformOrigin: "top left",
      }}
      type="button"
    >
      {index + 1}
    </button>
  );
}
