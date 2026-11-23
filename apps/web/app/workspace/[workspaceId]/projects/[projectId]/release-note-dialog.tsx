"use client";

import { useEffect, useId, useRef, useState } from "react";

export const releaseNoteMaxLength = 4000;

/**
 * Modal for writing a version's release note. A native modal dialog keeps focus inside it;
 * Escape, Cancel or a click on the backdrop closes it without saving. ⌘/Ctrl+Enter saves.
 */
export function ReleaseNoteDialog({ initialValue, onSave, onClose }: {
  initialValue: string;
  onSave: (note: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(initialValue);
  const titleId = useId();
  const hintId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal();
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus?.();
    };
  }, []);

  const save = () => onSave(draft.trim());

  return (
    <dialog
      aria-describedby={hintId}
      aria-labelledby={titleId}
      className="dial-popover fixed inset-0 m-auto w-[calc(100vw-2rem)] max-w-md overflow-hidden p-0 text-foreground backdrop:bg-black/70"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      ref={dialogRef}
    >
      <div className="p-5">
        <h2 className="text-[15px] font-semibold text-foreground" id={titleId}>Release note</h2>
        <p className="mt-1 text-[13px] leading-5 text-foreground-muted" id={hintId}>Tell reviewers what changed and what to focus on.</p>
        <textarea
          aria-labelledby={titleId}
          className="mt-4 block min-h-40 w-full resize-y rounded-control border border-transparent bg-surface-inset px-3 py-2.5 text-sm leading-6 text-foreground placeholder:text-foreground-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          maxLength={releaseNoteMaxLength}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              save();
            }
          }}
          placeholder="What should reviewers focus on?"
          ref={textareaRef}
          value={draft}
        />
        <div className="mt-4 flex items-center justify-between gap-3">
          <span aria-live="polite" className="text-[11px] tabular-nums text-foreground-subtle">
            {draft.length > releaseNoteMaxLength - 400 ? `${releaseNoteMaxLength - draft.length} characters left` : ""}
          </span>
          <div className="flex gap-2">
            <button className="dial-button min-h-9 px-4 text-[13px]" onClick={onClose} type="button">Cancel</button>
            <button className="capture-primary-action min-h-9 rounded-control px-4 text-[13px] font-semibold" onClick={save} type="button">Save note</button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
