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

  // A speech bubble whose pointed bottom-left corner sits on the commented spot, as in Figma.
  return (
    <button
      aria-label={`Comment ${index + 1} by ${author}: ${comment.body}${comment.resolvedAt ? ". Resolved" : ". Open"}`}
      aria-pressed={selected}
      className="comment-pin absolute z-30 grid h-7 min-w-7 place-items-center px-1.5 font-mono text-[11px] font-semibold tabular-nums"
      onClick={() => onSelect(comment.id)}
      data-resolved={comment.resolvedAt ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      style={{
        left: comment.x,
        top: comment.y - 28,
        transform: `scale(${inverseScale})`,
        transformOrigin: "bottom left",
      }}
      type="button"
    >
      {index + 1}
    </button>
  );
}
