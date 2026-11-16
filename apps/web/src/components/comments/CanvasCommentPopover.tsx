"use client";

import { CommentBody } from "./mentions";

import { useState } from "react";
import type { HandoffComment } from "./CommentPin";
import { CommentComposer, type PendingCommentPoint } from "./CommentThread";

const popoverWidth = 300;
const pinGap = 22;

type Placement = {
  /** Pin position in the canvas layer's coordinates (before zoom). */
  x: number;
  y: number;
  inverseScale: number;
  /** Open to the left when the pin is too close to the viewport's right edge. */
  flip: boolean;
};

type CanvasCommentPopoverProps = Placement & (
  | {
      mode: "compose";
      point: PendingCommentPoint;
      onCreate: (body: string, point: PendingCommentPoint) => Promise<void>;
      onClose: () => void;
    }
  | {
      mode: "thread";
      root: HandoffComment;
      replies: HandoffComment[];
      index: number;
      canWrite: boolean;
      canResolve: boolean;
      onReply: (parentCommentId: string, body: string) => Promise<void>;
      onResolve: (commentId: string, resolved: boolean) => Promise<void>;
      onClose: () => void;
    }
);

function timeLabel(value: string) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Author({ comment }: { comment: HandoffComment }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-strong text-[10px] font-semibold text-foreground">
        {comment.authorName.trim().slice(0, 1).toUpperCase() || "?"}
      </span>
      <span className="truncate text-[12px] font-medium text-foreground">{comment.authorName}</span>
      {comment.authorRole ? <span className="shrink-0 rounded bg-surface-strong px-1 py-0.5 text-[9px] uppercase tracking-wide text-foreground-muted">{comment.authorRole}</span> : null}
      <span className="shrink-0 text-[10px] text-foreground-subtle">{timeLabel(comment.createdAt)}</span>
    </span>
  );
}

/**
 * Figma-style comment UI anchored beside a pin. It lives inside the zoomed canvas layer and
 * counter-scales, so it follows the pin while panning and zooming but stays screen-sized.
 * `data-comment-pin` keeps canvas click and drag handlers from treating it as canvas input.
 */
export function CanvasCommentPopover(props: CanvasCommentPopoverProps) {
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const { x, y, inverseScale, flip } = props;
  const labelId = `canvas-comment-${props.mode === "thread" ? props.root.id : "new"}`;

  async function toggleResolved() {
    if (props.mode !== "thread") return;
    setResolving(true);
    setResolveError(null);
    try {
      await props.onResolve(props.root.id, !props.root.resolvedAt);
    } catch (cause) {
      setResolveError(cause instanceof Error ? cause.message : "Could not update this thread.");
    } finally {
      setResolving(false);
    }
  }

  return (
    <div
      aria-labelledby={labelId}
      className="dial-popover absolute z-40 flex max-h-[420px] flex-col overflow-hidden text-foreground"
      data-comment-pin
      data-comment-popover
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      role="dialog"
      style={{
        left: flip ? x - (pinGap + popoverWidth) * inverseScale : x + pinGap * inverseScale,
        top: y - 16 * inverseScale,
        width: popoverWidth,
        transform: `scale(${inverseScale})`,
        transformOrigin: "top left",
      }}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-[12px] font-semibold text-foreground" id={labelId}>
          {props.mode === "compose" ? "New comment" : `Comment ${props.index + 1}`}
          {props.mode === "thread" && props.root.resolvedAt ? <span className="ml-1.5 font-normal text-foreground-subtle">· Resolved</span> : null}
        </h2>
        <span className="flex items-center gap-1">
          {props.mode === "thread" && props.canResolve ? (
            <button
              className="dial-button min-h-7 px-2 text-[11px]"
              disabled={resolving}
              onClick={() => void toggleResolved()}
              type="button"
            >
              {resolving ? "Saving…" : props.root.resolvedAt ? "Reopen" : "Resolve"}
            </button>
          ) : null}
          <button
            aria-label="Close comment"
            className="grid size-7 place-items-center rounded-control text-foreground-subtle hover:bg-surface-raised hover:text-foreground"
            onClick={props.onClose}
            type="button"
          >
            <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 16 16"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>
          </button>
        </span>
      </header>

      {props.mode === "compose" ? (
        <div className="p-3">
          <CommentComposer autoFocus compact label="Add a comment" onCancel={props.onClose} onSubmit={(body) => props.onCreate(body, props.point)} submitLabel="Post" />
        </div>
      ) : (
        <>
          <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {[props.root, ...props.replies].map((comment) => (
              <li key={comment.id}>
                <Author comment={comment} />
                <p className="mt-1 whitespace-pre-wrap break-words pl-7 text-[12px] leading-5 text-foreground-muted"><CommentBody body={comment.body} /></p>
              </li>
            ))}
          </ol>
          {resolveError ? <p className="px-3 pb-2 text-[11px] text-warning" role="alert">{resolveError}</p> : null}
          {props.canWrite ? (
            <div className="border-t border-border p-3">
              <CommentComposer autoFocus compact label="Reply" onSubmit={(body) => props.onReply(props.root.id, body)} submitLabel="Reply" />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
