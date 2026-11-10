"use client";

import { useState } from "react";
import type { PendingCommentPoint } from "../comments/CommentThread";
import { overviewCanvasFrameId } from "./canvas-anchor";

export type CanvasAnnotationRecord = {
  id: string;
  frameId: string;
  sourceNodeId: string | null;
  x: number;
  y: number;
  title: string;
  body: string;
  authorName: string;
};

export function CanvasAnnotationsPanel({
  annotations,
  screenNames,
  selectedAnnotationId,
  pendingPoint,
  placing,
  canEdit,
  hasSelectedScreen,
  error,
  onSelect,
  onStartPlacement,
  onPlaceAtSelectedScreen,
  onCancel,
  onCreate,
  onUpdate,
  onDelete,
}: {
  annotations: CanvasAnnotationRecord[];
  screenNames: Record<string, string>;
  selectedAnnotationId: string | null;
  pendingPoint: PendingCommentPoint | null;
  placing: boolean;
  canEdit: boolean;
  hasSelectedScreen: boolean;
  error: string | null;
  onSelect: (annotationId: string) => void;
  onStartPlacement: () => void;
  onPlaceAtSelectedScreen: () => void;
  onCancel: () => void;
  onCreate: (point: PendingCommentPoint, title: string, body: string) => Promise<void>;
  onUpdate: (annotationId: string, title: string, body: string) => Promise<void>;
  onDelete: (annotationId: string) => Promise<void>;
}) {
  const selected = annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null;
  const [title, setTitle] = useState(selected?.title ?? "");
  const [body, setBody] = useState(selected?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const editing = canEdit && Boolean(selected || pendingPoint);
  async function save() {
    if (!title.trim() || !body.trim()) {
      setActionError("Enter a short title and note.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      if (selected) await onUpdate(selected.id, title, body);
      else if (pendingPoint) await onCreate(pendingPoint, title, body);
      onCancel();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not save the canvas note.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selected) return;
    setSaving(true);
    setActionError(null);
    try {
      await onDelete(selected.id);
      onCancel();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not delete the canvas note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-[#202020] p-3 text-[#d0d0d0]">
      <section className="rounded-[6px] border border-[#3b3b3b] bg-[#252525] p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-[12px] font-semibold text-[#ededed]">Canvas notes</h2>
            <p className="mt-1 text-[10px] leading-4 text-[#999]">Notes stay visible on the design canvas and belong to this immutable version. Comments remain threaded separately.</p>
          </div>
          <span className="shrink-0 rounded-full bg-[#39332a] px-2 py-1 font-mono text-[9px] text-[#e0c68d]">{annotations.length}</span>
        </div>
        {canEdit ? (
          <button
            className="mt-3 min-h-8 rounded-[5px] bg-[#4b412d] px-2.5 text-[10px] font-medium text-[#f4d89e] hover:bg-[#5a4b30] disabled:opacity-50"
            disabled={placing || Boolean(pendingPoint)}
            onClick={onStartPlacement}
            type="button"
          >
            Add canvas note
          </button>
        ) : null}
        {placing ? (
          <div aria-live="polite" className="mt-2 space-y-2 text-[10px] leading-4 text-[#d8bf89]">
            <p>Click a frame or empty canvas point to place a note, or use the button to place it at the selected screen center.</p>
            <button
              className="min-h-8 rounded-[5px] border border-[#76633a] px-2.5 text-[10px] font-medium text-[#f4d89e] hover:bg-[#393329] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!hasSelectedScreen}
              onClick={onPlaceAtSelectedScreen}
              type="button"
            >
              Place at center of selected screen
            </button>
            {!hasSelectedScreen ? <p className="text-[#b9aa86]">Select a screen to enable this option.</p> : null}
          </div>
        ) : null}
      </section>

      {editing ? (
        <section className="rounded-[6px] border border-[#76633a] bg-[#29251d] p-3" aria-label={selected ? "Edit canvas note" : "Add canvas note"}>
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#d3b975]">{selected ? "Edit note" : "New note"}</p>
          {pendingPoint ? <p className="mt-1 text-[10px] text-[#a99975]">Placed on {screenNames[pendingPoint.frameId] ?? (pendingPoint.frameId === overviewCanvasFrameId ? "Canvas" : "selected screen")}</p> : null}
          <label className="mt-3 block text-[10px] text-[#bbb]" htmlFor="canvas-note-title">Title</label>
          <input aria-describedby={actionError ? "canvas-note-error" : undefined} autoFocus={!selected && Boolean(pendingPoint)} className="mt-1 h-8 w-full rounded-[4px] border border-[#514831] bg-[#1b1a17] px-2 text-[11px] text-white outline-none focus:border-[#c3a65f]" id="canvas-note-title" maxLength={120} onChange={(event) => setTitle(event.target.value)} required value={title} />
          <label className="mt-2 block text-[10px] text-[#bbb]" htmlFor="canvas-note-body">Annotation</label>
          <textarea aria-describedby={actionError ? "canvas-note-error" : undefined} className="mt-1 min-h-24 w-full resize-y rounded-[4px] border border-[#514831] bg-[#1b1a17] px-2 py-1.5 text-[11px] leading-5 text-white outline-none focus:border-[#c3a65f]" id="canvas-note-body" maxLength={2000} onChange={(event) => setBody(event.target.value)} required value={body} />
          <div className="mt-2 flex justify-end gap-1.5">
            <button className="min-h-8 rounded-[4px] px-2 text-[10px] text-[#aaa] hover:bg-[#39352c]" onClick={onCancel} type="button">Cancel</button>
            {selected ? <button className="min-h-8 rounded-[4px] px-2 text-[10px] text-[#e69a90] hover:bg-[#432e2c] disabled:opacity-50" disabled={saving} onClick={() => void remove()} type="button">Delete</button> : null}
            <button className="min-h-8 rounded-[4px] bg-[#d7b86e] px-2.5 text-[10px] font-semibold text-[#2b2415] hover:bg-[#e8cc89] disabled:opacity-50" disabled={saving || !pendingPoint && !selected} onClick={() => void save()} type="button">{saving ? "Saving…" : selected ? "Save note" : "Add note"}</button>
          </div>
          {actionError ? <p className="mt-2 text-[10px] text-[#f0a29c]" id="canvas-note-error" role="alert">{actionError}</p> : null}
        </section>
      ) : null}

      {error ? <p className="rounded-[4px] bg-[#3b2928] px-2.5 py-2 text-[10px] leading-4 text-[#f0a29c]" role="alert">{error}</p> : null}
      <ol className="space-y-2">
        {annotations.map((annotation) => (
          <li key={annotation.id}>
            <button
              aria-pressed={annotation.id === selectedAnnotationId}
              className={"w-full rounded-[6px] border p-2.5 text-left transition-colors " + (annotation.id === selectedAnnotationId ? "border-[#8e7440] bg-[#332c20]" : "border-[#3a3a3a] bg-[#242424] hover:bg-[#2d2d2d]")}
              onClick={() => onSelect(annotation.id)}
              type="button"
            >
              <span className="block text-[11px] font-semibold text-[#e8d7ad]">{annotation.title}</span>
              <span className="mt-1 block whitespace-pre-wrap break-words text-[10px] leading-4 text-[#c5c0b3]">{annotation.body}</span>
              <span className="mt-1.5 block text-[9px] text-[#8f8b80]">{screenNames[annotation.frameId] ?? "Screen"} · {annotation.authorName}</span>
            </button>
          </li>
        ))}
        {!annotations.length ? <li className="rounded-[5px] border border-dashed border-[#3d3d3d] px-3 py-5 text-center text-[10px] text-[#888]">No canvas notes on this version yet.</li> : null}
      </ol>
    </div>
  );
}
