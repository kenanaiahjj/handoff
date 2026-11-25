import { useState } from "react";

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

/** The author on a pin: their photo, or the first letter of their first name. */
function PinFace({ name, image }: { name: string; image: string | null | undefined }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (image && failed !== image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- small photo from our own route or the sign-in provider.
      <img
        alt=""
        className="comment-pin-photo size-full rounded-full object-cover"
        draggable={false}
        onError={() => setFailed(image)}
        referrerPolicy="no-referrer"
        src={image}
      />
    );
  }
  return <span aria-hidden="true">{name.trim().charAt(0).toUpperCase() || "?"}</span>;
}

export function CommentPin({ comment, index, inverseScale, selected, onSelect }: CommentPinProps) {
  if (comment.x === null || comment.y === null) return null;
  const author = comment.authorRole ? `${comment.authorName} · ${comment.authorRole.toUpperCase()}` : comment.authorName;

  // A speech bubble whose pointed bottom-left corner sits on the commented spot, as in Figma.
  return (
    <button
      aria-label={`Comment ${index + 1} by ${author}: ${comment.body}${comment.resolvedAt ? ". Resolved" : ". Open"}`}
      aria-pressed={selected}
      className="comment-pin absolute z-30 grid size-7 place-items-center overflow-hidden p-[2px] text-[12px] font-semibold"
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
      <PinFace image={comment.authorImage} name={comment.authorName} />
    </button>
  );
}
