"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { activeMentionQuery, CommentBody, encodeMentions, type MentionPerson, useMentionMatches } from "./mentions";
import type { CanvasFrameOption } from "../canvas/FrameNavigator";
import { overviewCanvasFrameId } from "../canvas/canvas-anchor";
import type { CommentIdentity, HandoffComment } from "./CommentPin";

export type PendingCommentPoint = {
  frameId: string;
  sourceNodeId: string | null;
  x: number;
  y: number;
};

type CommentThreadProps = {
  comments: HandoffComment[];
  frames: CanvasFrameOption[];
  pendingPoint: PendingCommentPoint | null;
  selectedCommentId: string | null;
  error: string | null;
  openCount: number;
  canWrite: boolean;
  canResolve: boolean;
  commentIdentity: CommentIdentity | null;
  hasSelectedScreen: boolean;
  showResolvedPins: boolean;
  commentMode: boolean;
  onCreate: (body: string, point: PendingCommentPoint) => Promise<void>;
  onReply: (parentCommentId: string, body: string) => Promise<void>;
  onResolve: (commentId: string, resolved: boolean) => Promise<void>;
  onSelect: (commentId: string) => void;
  onStartComment: () => void;
  onPlaceAtSelectedScreen: () => void;
  onToggleResolvedPins: (show: boolean) => void;
};

export function CommentComposer({
  label,
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus = false,
  compact = false,
}: {
  label: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Smaller field for the on-canvas popover; Enter sends and Shift+Enter adds a line. */
  compact?: boolean;
}) {
  const inputId = useId();
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // "@query" being typed, the people picked so far, and the highlighted suggestion.
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [picked, setPicked] = useState<MentionPerson[]>([]);
  const [highlight, setHighlight] = useState(0);
  const matches = useMentionMatches(mention?.query ?? null);
  const suggesting = Boolean(mention && matches.length);

  function trackMention(text: string, caret: number) {
    setMention(activeMentionQuery(text, caret));
    setHighlight(0);
  }

  function pickPerson(person: MentionPerson) {
    if (!mention) return;
    const caret = textareaRef.current?.selectionStart ?? body.length;
    const next = `${body.slice(0, mention.start)}@${person.name} ${body.slice(caret)}`;
    setBody(next);
    setPicked((current) => (current.some((entry) => entry.id === person.id) ? current : [...current, person]));
    setMention(null);
    const position = mention.start + person.name.length + 2;
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(position, position);
    });
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!body.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(encodeMentions(body.trim(), picked));
      setBody("");
      setPicked([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The comment could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-2" onSubmit={submit}>
      <label className="sr-only" htmlFor={inputId}>{label}</label>
      <textarea
        autoFocus={autoFocus}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className={(compact ? "min-h-16 resize-none" : "min-h-20 resize-y") + " w-full rounded-control border border-transparent bg-surface-inset px-3 py-2 text-[12px] leading-5 text-foreground placeholder:text-foreground-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"}
        id={inputId}
        maxLength={4000}
        onChange={(event) => {
          setBody(event.target.value);
          trackMention(event.target.value, event.target.selectionStart);
        }}
        onClick={(event) => trackMention(event.currentTarget.value, event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (suggesting) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              pickPerson(matches[highlight]);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setMention(null);
              return;
            }
          }
          if (compact && event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder={label}
        ref={textareaRef}
        required
        value={body}
      />
      {suggesting ? (
        <ul aria-label="Mention someone" className="dial-popover max-h-48 overflow-y-auto p-1" role="listbox">
          {matches.map((person, index) => (
            <li
              aria-selected={index === highlight}
              className="mention-option flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5"
              data-active={index === highlight || undefined}
              key={person.id}
              onMouseDown={(event) => {
                event.preventDefault();
                pickPerson(person);
              }}
              onMouseMove={() => setHighlight(index)}
              role="option"
            >
              <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-strong text-[9px] font-semibold">
                {person.name.trim().slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 truncate text-[12px] text-foreground">{person.name}</span>
              <span className="min-w-0 truncate text-[11px] text-foreground-subtle">{person.email}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-[11px] text-warning" id={`${inputId}-error`} role="alert">{error}</p> : null}
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] text-foreground-subtle">{compact ? "Enter to send · @ to mention" : `@ to mention · ${body.length}/4000`}</span>
        <span className="flex items-center gap-1">
          {onCancel ? <button className="dial-button min-h-8 px-2.5 text-[11px]" onClick={onCancel} type="button">Cancel</button> : null}
          <button className="min-h-8 rounded-control bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50" disabled={!body.trim() || saving} type="submit">
            {saving ? "Saving…" : submitLabel}
          </button>
        </span>
      </div>
    </form>
  );
}

export function CommentThread({
  comments,
  frames,
  pendingPoint,
  selectedCommentId,
  error,
  openCount,
  canWrite,
  canResolve,
  commentIdentity,
  hasSelectedScreen,
  showResolvedPins,
  commentMode,
  onCreate,
  onReply,
  onResolve,
  onSelect,
  onStartComment,
  onPlaceAtSelectedScreen,
  onToggleResolvedPins,
}: CommentThreadProps) {
  const [activeTab, setActiveTab] = useState<"open" | "resolved">("open");
  const roots = comments.filter((comment) => comment.parentCommentId === null);
  const visibleRoots = roots.filter((comment) => activeTab === "resolved" ? Boolean(comment.resolvedAt) : !comment.resolvedAt);
  const frameName = (frameId: string) => frameId === overviewCanvasFrameId ? "Canvas" : frames.find((frame) => frame.id === frameId)?.name ?? "Screen";

  return (
    <section aria-labelledby="comments-title" className="text-foreground-muted">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-foreground" id="comments-title">Comments</h2>
        {canWrite ? <button
          aria-pressed={commentMode}
          className="dial-button min-h-8 px-2.5 text-[11px]"
          onClick={onStartComment}
          type="button"
        >
          {commentMode ? "Cancel" : "Add comment"}
        </button> : null}
      </div>
      <p className="mt-1 text-[11px] text-foreground-subtle">{openCount} open · {roots.length} total</p>
      {commentIdentity ? <p className="mt-2 rounded-control bg-surface-raised px-2.5 py-2 text-[10px] leading-4 text-foreground-muted">Comments will appear as {commentIdentity.label} · {commentIdentity.role.toUpperCase()}. Anyone with this invite link can post using that label.</p> : null}

      <div aria-label="Comment status" className="dial-segmented mt-4 grid w-full grid-cols-2" role="group">
        {(["open", "resolved"] as const).map((tab) => (
          <button
            aria-pressed={activeTab === tab}
            className="min-h-8 px-2.5 text-[12px] capitalize"
            key={tab}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {tab} <span className="ml-1 font-mono text-[10px] text-foreground-subtle">{roots.filter((comment) => tab === "resolved" ? Boolean(comment.resolvedAt) : !comment.resolvedAt).length}</span>
          </button>
        ))}
      </div>

      <label className="flex min-h-9 items-center gap-2 text-[11px] text-foreground-muted">
        <input
          checked={showResolvedPins}
          className="size-3.5 accent-foreground-muted"
          onChange={(event) => onToggleResolvedPins(event.target.checked)}
          type="checkbox"
        />
        Show resolved pins
      </label>

      {commentMode ? (
        <div aria-live="polite" className="rounded-control bg-surface-raised px-2.5 py-2 text-[11px] leading-5 text-foreground">
          <p>Click a frame or empty canvas point to place a comment pin, or use the button to place it at the selected screen center.</p>
          <button
            className="mt-2 min-h-8 rounded-control border border-border-strong px-2.5 text-[11px] text-foreground hover:bg-surface-strong disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!hasSelectedScreen}
            onClick={onPlaceAtSelectedScreen}
            type="button"
          >
            Place at center of selected screen
          </button>
          {!hasSelectedScreen ? <p className="mt-1 text-foreground-muted">Select a screen to enable this option.</p> : null}
        </div>
      ) : null}
      {pendingPoint && canWrite ? (
        <div className="mt-3 rounded-control border border-border-strong bg-surface-muted p-3">
          <p className="mb-1 text-[12px] font-medium text-foreground">Comment on {frameName(pendingPoint.frameId)}</p>
          <p className="mb-3 font-mono text-[10px] text-foreground-subtle">
            {Math.round(pendingPoint.x)}, {Math.round(pendingPoint.y)} source units
            {pendingPoint.sourceNodeId ? " · selected element" : pendingPoint.frameId === overviewCanvasFrameId ? " · canvas point" : " · screen point"}
          </p>
          <CommentComposer autoFocus label="Write a comment" submitLabel="Comment" onSubmit={(body) => onCreate(body, pendingPoint)} />
        </div>
      ) : null}
      {error ? <p aria-live="assertive" className="mt-3 rounded-control border border-[#76522a] bg-[#332718] p-2.5 text-[11px] text-[#efb45f]">{error}</p> : null}

      {visibleRoots.length ? (
        <ol className="mt-2">
          {visibleRoots.map((comment, index) => {
            const replies = comments.filter((reply) => reply.parentCommentId === comment.id);
            const selected = selectedCommentId === comment.id;
            return (
              <li className={"my-1.5 rounded-control px-3 py-3 " + (selected ? "bg-surface-raised" : "bg-surface-inset")} key={comment.id}>
                <article>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button className="flex min-w-0 items-center gap-2 text-left" onClick={() => onSelect(comment.id)} type="button">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-strong font-mono text-[10px] text-white">{index + 1}</span>
                    <span className="truncate text-[11px] font-medium text-foreground">{comment.authorName}{comment.authorRole ? <span className="ml-1 rounded bg-surface-strong px-1 py-0.5 text-[9px] uppercase tracking-wide text-foreground-muted">{comment.authorRole}</span> : null}</span>
                    </button>
                    <span className="text-[10px] text-foreground-subtle">{new Date(comment.createdAt).toLocaleString()}</span>
                  </div>
                  <button className="ml-7 mt-2 block text-left text-[12px] leading-5 text-foreground-muted hover:text-white" onClick={() => onSelect(comment.id)} type="button">
                    <CommentBody body={comment.body} />
                  </button>
                  <p className="ml-7 mt-1.5 text-[10px] text-foreground-subtle">{frameName(comment.frameId)}{comment.sourceNodeId ? " · element linked" : ""}</p>
                  <div className="ml-7 mt-2 flex flex-wrap gap-3">
                    {canResolve ? <button className="min-h-7 text-[10px] text-foreground-muted hover:text-white hover:underline" onClick={() => onResolve(comment.id, !comment.resolvedAt)} type="button">{comment.resolvedAt ? "Reopen" : "Resolve"}</button> : null}
                    <button className="min-h-7 text-[10px] text-foreground-muted hover:text-white hover:underline" onClick={() => onSelect(comment.id)} type="button">Show pin</button>
                  </div>
                  {replies.length ? (
                    <ol className="ml-7 mt-3 space-y-2 border-l border-border-strong pl-3">
                      {replies.map((reply) => (
                        <li key={reply.id}>
                          <p className="text-[10px] text-foreground-subtle"><span className="font-medium text-foreground-muted">{reply.authorName}{reply.authorRole ? <span className="ml-1 uppercase tracking-wide">{reply.authorRole}</span> : null}</span> · {new Date(reply.createdAt).toLocaleString()}</p>
                          <p className="mt-1 text-[11px] leading-5 text-foreground-muted"><CommentBody body={reply.body} /></p>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {canWrite ? <div className="ml-7 mt-2">
                    <details>
                      <summary className="min-h-7 cursor-pointer text-[10px] text-foreground-subtle hover:text-white">Reply</summary>
                      <div className="mt-2"><CommentComposer label={"Reply to " + comment.authorName} submitLabel="Reply" onSubmit={(body) => onReply(comment.id, body)} /></div>
                    </details>
                  </div> : null}
                </article>
              </li>
            );
          })}
        </ol>
      ) : !pendingPoint ? (
        <p className="mt-4 text-[12px] text-foreground-subtle">{activeTab === "open" ? "No open comments" : "No resolved comments"}</p>
      ) : null}
    </section>
  );
}
