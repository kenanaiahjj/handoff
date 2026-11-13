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
  authorRole: HandoffInviteRole | null;
  createdAt: string;
};

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
      className={`absolute z-10 grid size-7 place-items-center rounded-full border-2 text-[10px] font-semibold shadow-lg outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-white ${comment.resolvedAt ? "border-foreground-subtle bg-surface-raised text-foreground-muted" : "border-primary-foreground bg-accent text-primary-foreground"} ${selected ? "scale-125 ring-2 ring-accent" : ""}`}
      onClick={() => onSelect(comment.id)}
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
