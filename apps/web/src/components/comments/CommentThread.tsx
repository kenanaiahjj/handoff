"use client";

import { Avatar } from "@/src/components/Avatar";
import { useId, useRef, useState, type FormEvent } from "react";
import { activeMentionQuery, CommentBody, encodeMentions, type MentionPerson, useMentionMatches } from "./mentions";
import type { CanvasFrameOption } from "../canvas/FrameNavigator";
import { overviewCanvasFrameId } from "../canvas/canvas-anchor";
import type { CommentAttachment, CommentIdentity, HandoffComment } from "./CommentPin";
import { acceptedImageTypes, attachmentUrl, CommentAttachments, CommentTime, ImageLightbox, uploadCommentImage, useCommentEndpoint } from "./comment-media";

export type PendingCommentPoint = {
  frameId: string;
  sourceNodeId: string | null;
  x: number;
  y: number;
};

export type CommentSubmit = (body: string, attachmentIds: string[]) => Promise<void>;

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
  onCreate: (body: string, point: PendingCommentPoint, attachmentIds: string[]) => Promise<void>;
  onReply: (parentCommentId: string, body: string, attachmentIds: string[]) => Promise<void>;
  onResolve: (commentId: string, resolved: boolean) => Promise<void>;
  onSelect: (commentId: string) => void;
  onStartComment: () => void;
  onPlaceAtSelectedScreen: () => void;
  onToggleResolvedPins: (show: boolean) => void;
};

const maxAttachments = 4;
type Upload = { key: string; preview: string; attachment: CommentAttachment | null; error: string | null };

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
  onSubmit: CommentSubmit;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Smaller field for the on-canvas popover. */
  compact?: boolean;
}) {
  const inputId = useId();
  const endpoint = useCommentEndpoint();
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // "@query" being typed, the people picked so far, and the highlighted suggestion.
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [picked, setPicked] = useState<MentionPerson[]>([]);
  const [highlight, setHighlight] = useState(0);
  const matches = useMentionMatches(mention?.query ?? null);
  const suggesting = Boolean(mention && matches.length);
  const uploading = uploads.some((upload) => !upload.attachment && !upload.error);
  const ready = Boolean(body.trim()) && !saving && !uploading;

  function trackMention(text: string, caret: number) {
    setMention(activeMentionQuery(text, caret));
    setHighlight(0);
  }

  function grow(element: HTMLTextAreaElement | null) {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = Math.min(element.scrollHeight, 200) + "px";
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

  function addFiles(files: Iterable<File>) {
    if (!endpoint) return;
    const images = [...files].filter((file) => acceptedImageTypes.includes(file.type));
    if (!images.length) {
      setError("Use a PNG, JPEG, WebP or GIF image.");
      return;
    }
    const room = maxAttachments - uploads.filter((upload) => !upload.error).length;
    if (room <= 0) {
      setError(`Up to ${maxAttachments} images per comment.`);
      return;
    }
    setError(images.length > room ? `Up to ${maxAttachments} images per comment.` : null);
    for (const file of images.slice(0, room)) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      setUploads((current) => [...current, { key, preview: URL.createObjectURL(file), attachment: null, error: null }]);
      uploadCommentImage(endpoint, file)
        .then((attachment) => setUploads((current) => current.map((upload) => (upload.key === key ? { ...upload, attachment } : upload))))
        .catch((cause: unknown) => setUploads((current) => current.map((upload) => (upload.key === key ? { ...upload, error: cause instanceof Error ? cause.message : "Upload failed." } : upload))));
    }
  }

  function removeUpload(key: string) {
    setUploads((current) => {
      const removed = current.find((upload) => upload.key === key);
      if (removed) URL.revokeObjectURL(removed.preview);
      return current.filter((upload) => upload.key !== key);
    });
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(encodeMentions(body.trim(), picked), uploads.flatMap((upload) => (upload.attachment ? [upload.attachment.id] : [])));
      setBody("");
      setPicked([]);
      uploads.forEach((upload) => URL.revokeObjectURL(upload.preview));
      setUploads([]);
      window.requestAnimationFrame(() => grow(textareaRef.current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The comment could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={"comment-composer relative rounded-[10px] border bg-surface-inset transition-colors " + (dragging ? "border-primary" : "border-white/[0.08] focus-within:border-white/[0.2]")}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDragOver={(event) => {
        if (!endpoint || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDrop={(event) => {
        if (!endpoint) return;
        event.preventDefault();
        setDragging(false);
        addFiles(event.dataTransfer.files);
      }}
      onSubmit={submit}
    >
      <label className="sr-only" htmlFor={inputId}>{label}</label>
      <textarea
        autoFocus={autoFocus}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className={(compact ? "min-h-10" : "min-h-16") + " block w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-[13px] leading-5 text-foreground outline-none placeholder:text-foreground-subtle"}
        id={inputId}
        maxLength={4000}
        onChange={(event) => {
          setBody(event.target.value);
          grow(event.target);
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
          if (event.key === "Escape" && onCancel && !body) {
            event.preventDefault();
            onCancel();
            return;
          }
          // Enter sends; Shift+Enter adds a line. ⌘/Ctrl+Enter also sends, for people used to that.
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
        onPaste={(event) => {
          const files = [...event.clipboardData.files];
          if (files.length && endpoint) {
            event.preventDefault();
            addFiles(files);
          }
        }}
        placeholder={label}
        ref={textareaRef}
        rows={1}
        value={body}
      />
      {uploads.length ? (
        <ul aria-label="Attached images" className="flex flex-wrap gap-1.5 px-3 pb-1 pt-1.5">
          {uploads.map((upload) => (
            <li className="relative" key={upload.key}>
              <button
                className={"block size-14 overflow-hidden rounded-[7px] border " + (upload.error ? "border-danger/70" : "border-white/[0.1]")}
                onClick={() => setPreview(upload.preview)}
                title={upload.error ?? "Preview"}
                type="button"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file */}
                <img alt="" className={"size-full object-cover " + (upload.attachment ? "" : "opacity-50")} src={upload.preview} />
                {!upload.attachment && !upload.error ? <span aria-label="Uploading" className="absolute inset-0 grid place-items-center"><span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /></span> : null}
              </button>
              <button
                aria-label="Remove image"
                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-surface-strong text-foreground shadow ring-2 ring-surface-inset hover:bg-danger"
                onClick={() => removeUpload(upload.key)}
                type="button"
              >
                <svg aria-hidden="true" className="size-2.5" fill="none" viewBox="0 0 16 16"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {suggesting ? (
        <ul aria-label="Mention someone" className="dial-popover absolute inset-x-0 top-full z-10 mt-1 max-h-48 overflow-y-auto p-1" role="listbox">
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
      <div className="flex items-center gap-1 px-1.5 pb-1.5">
        {endpoint ? (
          <>
            <button
              aria-label="Attach an image"
              className="grid size-8 place-items-center rounded-[7px] text-foreground-subtle hover:bg-white/[0.06] hover:text-foreground disabled:opacity-40"
              disabled={uploads.length >= maxAttachments}
              onClick={() => fileRef.current?.click()}
              title="Attach an image (or paste / drop one)"
              type="button"
            >
              <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16"><rect height="11" rx="2" width="12" x="2" y="2.5" /><circle cx="6" cy="6.5" r="1.2" /><path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3" /></svg>
            </button>
            <input accept={acceptedImageTypes.join(",")} className="hidden" multiple onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} ref={fileRef} type="file" />
          </>
        ) : null}
        <button
          aria-label="Mention someone"
          className="grid size-8 place-items-center rounded-[7px] text-[15px] text-foreground-subtle hover:bg-white/[0.06] hover:text-foreground"
          onClick={() => {
            const element = textareaRef.current;
            if (!element) return;
            const caret = element.selectionStart ?? body.length;
            const prefix = caret > 0 && !/\s/.test(body[caret - 1]) ? " @" : "@";
            const next = body.slice(0, caret) + prefix + body.slice(caret);
            setBody(next);
            const position = caret + prefix.length;
            window.requestAnimationFrame(() => {
              element.focus();
              element.setSelectionRange(position, position);
              trackMention(next, position);
            });
          }}
          title="Mention someone"
          type="button"
        >
          @
        </button>
        <span className="ml-auto flex items-center gap-1">
          {onCancel ? <button className="min-h-8 rounded-[7px] px-2.5 text-[12px] text-foreground-muted hover:bg-white/[0.06] hover:text-foreground" onClick={onCancel} type="button">Cancel</button> : null}
          <button
            aria-label={submitLabel}
            className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-30"
            disabled={!ready}
            title={uploading ? "Waiting for images to upload" : `${submitLabel} (Enter)`}
            type="submit"
          >
            {saving ? <span className="size-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current" /> : <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 16 16"><path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" /></svg>}
          </button>
        </span>
      </div>
      {dragging ? <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-[10px] bg-surface/85 text-[12px] font-medium text-foreground">Drop image to attach</div> : null}
      {error ? <p className="px-3 pb-2 text-[11px] text-warning" id={`${inputId}-error`} role="alert">{error}</p> : null}
      {preview ? <ImageLightbox alt="Attached image" onClose={() => setPreview(null)} src={preview} /> : null}
    </form>
  );
}

function RolePill({ role }: { role: string | null }) {
  return role ? <span className="shrink-0 rounded-[4px] bg-white/[0.07] px-1 py-px text-[9px] font-medium uppercase tracking-wide text-foreground-muted">{role}</span> : null;
}

/** One comment or reply: avatar, name, time, text and images. */
export function CommentMessage({ comment, size = "root" }: { comment: HandoffComment; size?: "root" | "reply" }) {
  const avatar = size === "root" ? 28 : 22;
  return (
    <div className="flex gap-2.5">
      <span className="shrink-0 pt-0.5"><Avatar name={comment.authorName} size={avatar} src={comment.authorImage} /></span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[12px] font-semibold text-foreground">{comment.authorName}</span>
          <RolePill role={comment.authorRole} />
          <CommentTime iso={comment.createdAt} />
        </p>
        {comment.body.trim() ? <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground-muted"><CommentBody body={comment.body} /></p> : null}
        <CommentAttachments attachments={comment.attachments} className="mt-2" />
      </div>
    </div>
  );
}

function ResolveButton({ resolved, onToggle }: { resolved: boolean; onToggle: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      aria-label={resolved ? "Reopen thread" : "Resolve thread"}
      aria-pressed={resolved}
      className={"grid size-7 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-50 " + (resolved ? "bg-success/20 text-success hover:bg-success/30" : "text-foreground-subtle hover:bg-white/[0.08] hover:text-foreground")}
      disabled={busy}
      onClick={async (event) => {
        event.stopPropagation();
        setBusy(true);
        try { await onToggle(); } finally { setBusy(false); }
      }}
      title={resolved ? "Reopen" : "Resolve"}
      type="button"
    >
      <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" /><path d="m5.5 8.2 1.8 1.8 3.2-3.6" /></svg>
    </button>
  );
}

function ThreadCard({
  comment,
  replies,
  index,
  selected,
  frameLabel,
  canWrite,
  canResolve,
  onSelect,
  onReply,
  onResolve,
}: {
  comment: HandoffComment;
  replies: HandoffComment[];
  index: number;
  selected: boolean;
  frameLabel: string;
  canWrite: boolean;
  canResolve: boolean;
  onSelect: () => void;
  onReply: CommentSubmit;
  onResolve: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  const hidden = expanded ? 0 : Math.max(0, replies.length - 2);
  const shown = replies.slice(hidden);

  return (
    <li
      className={"comment-card group rounded-[12px] border p-3 transition-colors " + (selected ? "border-white/[0.18] bg-surface-raised" : "border-transparent bg-white/[0.025] hover:bg-white/[0.04]")}
      data-resolved={comment.resolvedAt ? "" : undefined}
    >
      <article aria-label={`Comment ${index + 1} by ${comment.authorName}`}>
        <div className="flex items-start gap-2">
          {/* Not a <button>: it holds image buttons. The location link below selects the thread by keyboard. */}
          <div className="min-w-0 flex-1 cursor-pointer" onClick={onSelect}>
            <CommentMessage comment={comment} />
          </div>
          <span className="flex shrink-0 items-center gap-0.5">
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white/[0.07] px-1.5 font-mono text-[10px] text-foreground-muted" title={`Pin ${index + 1}`}>{index + 1}</span>
            {canResolve ? <ResolveButton onToggle={onResolve} resolved={Boolean(comment.resolvedAt)} /> : null}
          </span>
        </div>
        <button className="ml-[38px] mt-2 flex max-w-[calc(100%-38px)] items-center gap-1 text-[11px] text-foreground-subtle hover:text-foreground" onClick={onSelect} title="Show on canvas" type="button">
          <svg aria-hidden="true" className="size-3 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16"><path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 1 0-9 0C3.5 9.8 8 14 8 14Z" /><circle cx="8" cy="6.5" r="1.5" /></svg>
          <span className="truncate">{frameLabel}{comment.sourceNodeId ? " · element" : ""}</span>
        </button>

        {replies.length || canWrite ? (
          <div className="ml-[38px] mt-3 space-y-3 border-l border-white/[0.08] pl-3">
            {hidden ? (
              <button className="text-[11px] font-medium text-foreground-muted hover:text-foreground" onClick={() => setExpanded(true)} type="button">
                Show {hidden} earlier {hidden === 1 ? "reply" : "replies"}
              </button>
            ) : null}
            {shown.map((reply) => <CommentMessage comment={reply} key={reply.id} size="reply" />)}
            {canWrite ? (
              replying ? (
                <CommentComposer
                  autoFocus
                  compact
                  label={`Reply to ${comment.authorName}`}
                  onCancel={() => setReplying(false)}
                  onSubmit={async (body, attachmentIds) => {
                    await onReply(body, attachmentIds);
                    setExpanded(true);
                  }}
                  submitLabel="Reply"
                />
              ) : (
                <button className="flex min-h-8 w-full items-center rounded-[8px] bg-white/[0.03] px-2.5 text-left text-[12px] text-foreground-subtle hover:bg-white/[0.06] hover:text-foreground-muted" onClick={() => setReplying(true)} type="button">
                  Reply…
                </button>
              )
            ) : null}
          </div>
        ) : null}
      </article>
    </li>
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
  const pinNumber = new Map(roots.map((comment, index) => [comment.id, index]));
  const visibleRoots = roots.filter((comment) => activeTab === "resolved" ? Boolean(comment.resolvedAt) : !comment.resolvedAt);
  const resolvedCount = roots.length - openCount;
  const frameName = (frameId: string) => frameId === overviewCanvasFrameId ? "Canvas" : frames.find((frame) => frame.id === frameId)?.name ?? "Screen";

  return (
    <section aria-labelledby="comments-title" className="text-foreground-muted">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-foreground" id="comments-title">Comments</h2>
        {canWrite ? (
          <button
            aria-pressed={commentMode}
            className={"inline-flex min-h-8 items-center gap-1.5 rounded-control px-3 text-[12px] font-semibold " + (commentMode ? "dial-button" : "bg-primary text-primary-foreground hover:bg-primary-hover")}
            onClick={onStartComment}
            type="button"
          >
            {commentMode ? "Cancel" : <><svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9" /></svg>Comment</>}
          </button>
        ) : null}
      </div>
      {commentIdentity ? <p className="mt-2 rounded-control bg-surface-raised px-2.5 py-2 text-[11px] leading-4 text-foreground-muted">You’re commenting as {commentIdentity.label} · {commentIdentity.role.toUpperCase()}. Anyone with this invite link posts under that name.</p> : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <div aria-label="Comment status" className="dial-segmented h-8" role="group">
          {(["open", "resolved"] as const).map((tab) => (
            <button aria-pressed={activeTab === tab} className="min-h-7 px-3 text-[12px] capitalize" key={tab} onClick={() => setActiveTab(tab)} type="button">
              {tab} <span className="ml-0.5 font-mono text-[10px] text-foreground-subtle">{tab === "open" ? openCount : resolvedCount}</span>
            </button>
          ))}
        </div>
        <label className="flex min-h-8 cursor-pointer items-center gap-1.5 text-[11px] text-foreground-subtle hover:text-foreground-muted">
          <input checked={showResolvedPins} className="size-3.5 accent-foreground-muted" onChange={(event) => onToggleResolvedPins(event.target.checked)} type="checkbox" />
          Resolved pins
        </label>
      </div>

      {commentMode ? (
        <div aria-live="polite" className="mt-3 rounded-[10px] border border-dashed border-white/[0.14] px-3 py-2.5 text-[12px] leading-5 text-foreground">
          <p>Click anywhere on a screen to drop a pin.</p>
          <button className="mt-1.5 text-[12px] font-medium text-foreground-muted underline-offset-2 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50" disabled={!hasSelectedScreen} onClick={onPlaceAtSelectedScreen} title={hasSelectedScreen ? undefined : "Select a screen first"} type="button">
            Or comment on the whole selected screen
          </button>
        </div>
      ) : null}
      {pendingPoint && canWrite ? (
        <div className="mt-3 space-y-2">
          <p className="text-[12px] font-medium text-foreground">New comment on {frameName(pendingPoint.frameId)}{pendingPoint.sourceNodeId ? " · element" : ""}</p>
          <CommentComposer autoFocus label="Add a comment" submitLabel="Post" onSubmit={(body, attachmentIds) => onCreate(body, pendingPoint, attachmentIds)} />
        </div>
      ) : null}
      {error ? <p aria-live="assertive" className="mt-3 rounded-control border border-[#76522a] bg-[#332718] p-2.5 text-[11px] text-[#efb45f]">{error}</p> : null}

      {visibleRoots.length ? (
        <ol className="mt-3 space-y-2">
          {visibleRoots.map((comment) => (
            <ThreadCard
              canResolve={canResolve}
              canWrite={canWrite}
              comment={comment}
              frameLabel={frameName(comment.frameId)}
              index={pinNumber.get(comment.id) ?? 0}
              key={comment.id}
              onReply={(body, attachmentIds) => onReply(comment.id, body, attachmentIds)}
              onResolve={() => onResolve(comment.id, !comment.resolvedAt)}
              onSelect={() => onSelect(comment.id)}
              replies={comments.filter((reply) => reply.parentCommentId === comment.id)}
              selected={selectedCommentId === comment.id}
            />
          ))}
        </ol>
      ) : !pendingPoint ? (
        <div className="mt-6 flex flex-col items-center px-4 text-center">
          <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-white/[0.05] text-foreground-subtle">
            <svg className="size-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16"><path d="M3 12.5V4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5A1.5 1.5 0 0 1 11.5 11H5.5L3 12.5Z" /></svg>
          </span>
          <p className="mt-3 text-[13px] font-medium text-foreground">{activeTab === "open" ? "No open comments" : "No resolved comments"}</p>
          {activeTab === "open" && canWrite ? <p className="mt-1 text-[12px] leading-5 text-foreground-subtle">Press C, then click a screen to leave feedback. You can attach screenshots.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

export { attachmentUrl };
