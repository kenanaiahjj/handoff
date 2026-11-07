export type HandoffComment = {
  id: string;
  frameId: string;
  sourceNodeId: string | null;
  x: number | null;
  y: number | null;
  parentCommentId: string | null;
  body: string;
  resolvedAt: string | null;
  createdBy: string;
  authorName: string;
  createdAt: string;
};

type CommentPinProps = {
  comment: HandoffComment;
  index: number;
  selected: boolean;
  onSelect: (commentId: string) => void;
};

export function CommentPin({ comment, index, selected, onSelect }: CommentPinProps) {
  if (comment.x === null || comment.y === null) return null;

  return (
    <button
      aria-label={`Comment ${index + 1} by ${comment.authorName}: ${comment.body}${comment.resolvedAt ? ". Resolved" : ". Open"}`}
      aria-pressed={selected}
      className={`absolute z-10 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 text-[10px] font-semibold shadow-lg outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-white ${comment.resolvedAt ? "border-foreground-subtle bg-surface-raised text-foreground-muted" : "border-primary-foreground bg-primary text-primary-foreground"} ${selected ? "scale-125 ring-2 ring-primary" : ""}`}
      onClick={() => onSelect(comment.id)}
      style={{ left: comment.x, top: comment.y }}
      type="button"
    >
      {index + 1}
    </button>
  );
}
