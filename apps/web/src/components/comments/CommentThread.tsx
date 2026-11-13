"use client";

import { useId, useState, type FormEvent } from "react";
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

function CommentComposer({
  label,
  submitLabel,
  onSubmit,
  autoFocus = false,
}: {
  label: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<void>;
  autoFocus?: boolean;
}) {
  const inputId = useId();
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(body.trim());
      setBody("");
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
        className="min-h-20 w-full resize-y rounded-[6px] border border-[#414141] bg-[#191919] px-3 py-2 text-[12px] leading-5 text-[#eee] placeholder:text-[#888] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
        id={inputId}
        maxLength={4000}
        onChange={(event) => setBody(event.target.value)}
        placeholder={label}
        required
        value={body}
      />
      {error ? <p className="text-[11px] text-[#efaa4a]" id={`${inputId}-error`} role="alert">{error}</p> : null}
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] text-[#888]">{body.length}/4000</span>
        <button className="min-h-8 rounded-[5px] bg-[#dedede] px-3 text-[11px] font-medium text-[#202020] disabled:cursor-not-allowed disabled:opacity-50" disabled={!body.trim() || saving} type="submit">
          {saving ? "Saving…" : submitLabel}
        </button>
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
    <section aria-labelledby="comments-title" className="text-[#d5d5d5]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-[#ededed]" id="comments-title">Comments</h2>
        {canWrite ? <button
          aria-pressed={commentMode}
          className="min-h-8 rounded-[5px] px-2.5 text-[11px] text-[#c8c8c8] hover:bg-[#353535] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#aaa]"
          onClick={onStartComment}
          type="button"
        >
          {commentMode ? "Cancel" : "Add comment"}
        </button> : null}
      </div>
      <p className="mt-1 text-[11px] text-[#969696]">{openCount} open · {roots.length} total</p>
      {commentIdentity ? <p className="mt-2 rounded-[5px] bg-[#303030] px-2.5 py-2 text-[10px] leading-4 text-[#bcbcbc]">Comments will appear as {commentIdentity.label} · {commentIdentity.role.toUpperCase()}. Anyone with this invite link can post using that label.</p> : null}

      <div aria-label="Comment status" className="mt-4 flex gap-1 border-b border-[#3b3b3b]" role="group">
        {(["open", "resolved"] as const).map((tab) => (
          <button
            aria-pressed={activeTab === tab}
            className={"border-b-2 px-2.5 py-2 text-[11px] capitalize " + (activeTab === tab ? "border-[#ddd] text-white" : "border-transparent text-[#999] hover:text-white")}
            key={tab}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {tab} <span className="ml-1 font-mono text-[10px] text-[#888]">{roots.filter((comment) => tab === "resolved" ? Boolean(comment.resolvedAt) : !comment.resolvedAt).length}</span>
          </button>
        ))}
      </div>

      <label className="flex min-h-9 items-center gap-2 text-[11px] text-[#aaa]">
        <input
          checked={showResolvedPins}
          className="size-3.5 accent-[#aaa]"
          onChange={(event) => onToggleResolvedPins(event.target.checked)}
          type="checkbox"
        />
        Show resolved pins
      </label>

      {commentMode ? (
        <div aria-live="polite" className="rounded-[5px] bg-[#343434] px-2.5 py-2 text-[11px] leading-5 text-[#ddd]">
          <p>Click a frame or empty canvas point to place a comment pin, or use the button to place it at the selected screen center.</p>
          <button
            className="mt-2 min-h-8 rounded-[5px] border border-[#555] px-2.5 text-[11px] text-[#ddd] hover:bg-[#414141] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!hasSelectedScreen}
            onClick={onPlaceAtSelectedScreen}
            type="button"
          >
            Place at center of selected screen
          </button>
          {!hasSelectedScreen ? <p className="mt-1 text-[#aaa]">Select a screen to enable this option.</p> : null}
        </div>
      ) : null}
      {pendingPoint && canWrite ? (
        <div className="mt-3 rounded-[6px] border border-[#555] bg-[#292929] p-3">
          <p className="mb-1 text-[12px] font-medium text-[#eee]">Comment on {frameName(pendingPoint.frameId)}</p>
          <p className="mb-3 font-mono text-[10px] text-[#969696]">
            {Math.round(pendingPoint.x)}, {Math.round(pendingPoint.y)} source units
            {pendingPoint.sourceNodeId ? " · selected element" : pendingPoint.frameId === overviewCanvasFrameId ? " · canvas point" : " · screen point"}
          </p>
          <CommentComposer autoFocus label="Write a comment" submitLabel="Comment" onSubmit={(body) => onCreate(body, pendingPoint)} />
        </div>
      ) : null}
      {error ? <p aria-live="assertive" className="mt-3 rounded-[5px] border border-[#76522a] bg-[#332718] p-2.5 text-[11px] text-[#efb45f]">{error}</p> : null}

      {visibleRoots.length ? (
        <ol className="mt-2 divide-y divide-[#393939]">
          {visibleRoots.map((comment, index) => {
            const replies = comments.filter((reply) => reply.parentCommentId === comment.id);
            const selected = selectedCommentId === comment.id;
            return (
              <li className={"py-3 " + (selected ? "bg-[#2e2e2e] px-2" : "")} key={comment.id}>
                <article>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button className="flex min-w-0 items-center gap-2 text-left" onClick={() => onSelect(comment.id)} type="button">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#414141] font-mono text-[10px] text-white">{index + 1}</span>
                    <span className="truncate text-[11px] font-medium text-[#e3e3e3]">{comment.authorName}{comment.authorRole ? <span className="ml-1 rounded bg-[#3a3a3a] px-1 py-0.5 text-[9px] uppercase tracking-wide text-[#aaa]">{comment.authorRole}</span> : null}</span>
                    </button>
                    <span className="text-[10px] text-[#8c8c8c]">{new Date(comment.createdAt).toLocaleString()}</span>
                  </div>
                  <button className="ml-7 mt-2 block text-left text-[12px] leading-5 text-[#c2c2c2] hover:text-white" onClick={() => onSelect(comment.id)} type="button">
                    {comment.body}
                  </button>
                  <p className="ml-7 mt-1.5 text-[10px] text-[#8e8e8e]">{frameName(comment.frameId)}{comment.sourceNodeId ? " · element linked" : ""}</p>
                  <div className="ml-7 mt-2 flex flex-wrap gap-3">
                    {canResolve ? <button className="min-h-7 text-[10px] text-[#aaa] hover:text-white hover:underline" onClick={() => onResolve(comment.id, !comment.resolvedAt)} type="button">{comment.resolvedAt ? "Reopen" : "Resolve"}</button> : null}
                    <button className="min-h-7 text-[10px] text-[#aaa] hover:text-white hover:underline" onClick={() => onSelect(comment.id)} type="button">Show pin</button>
                  </div>
                  {replies.length ? (
                    <ol className="ml-7 mt-3 space-y-2 border-l border-[#444] pl-3">
                      {replies.map((reply) => (
                        <li key={reply.id}>
                          <p className="text-[10px] text-[#8e8e8e]"><span className="font-medium text-[#c7c7c7]">{reply.authorName}{reply.authorRole ? <span className="ml-1 uppercase tracking-wide">{reply.authorRole}</span> : null}</span> · {new Date(reply.createdAt).toLocaleString()}</p>
                          <p className="mt-1 text-[11px] leading-5 text-[#b9b9b9]">{reply.body}</p>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {canWrite ? <div className="ml-7 mt-2">
                    <details>
                      <summary className="min-h-7 cursor-pointer text-[10px] text-[#969696] hover:text-white">Reply</summary>
                      <div className="mt-2"><CommentComposer label={"Reply to " + comment.authorName} submitLabel="Reply" onSubmit={(body) => onReply(comment.id, body)} /></div>
                    </details>
                  </div> : null}
                </article>
              </li>
            );
          })}
        </ol>
      ) : !pendingPoint ? (
        <p className="mt-4 text-[12px] text-[#999]">{activeTab === "open" ? "No open comments" : "No resolved comments"}</p>
      ) : null}
    </section>
  );
}
