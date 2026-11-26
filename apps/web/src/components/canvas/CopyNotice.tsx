"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const eventName = "asbir:copy-notice";

export type CopyNoticeTone = "pending" | "success" | "error";
type CopyNoticeDetail = { message: string; tone: CopyNoticeTone; detail?: string };

/**
 * Asks the canvas to show a copy message next to the cursor. Returns false when no canvas is open
 * to show it (the caller then falls back to a normal toast).
 */
export function showCopyNotice(message: string, tone: CopyNoticeTone, detail?: string) {
  if (typeof window === "undefined") return false;
  // A listener cancels the event to say it showed the message.
  return !window.dispatchEvent(new CustomEvent<CopyNoticeDetail>(eventName, { detail: { message, tone, detail }, cancelable: true }));
}

/**
 * Copy feedback right where people are looking: beside the cursor when it is over the canvas,
 * otherwise just above the canvas toolbar.
 */
export function CopyNotice() {
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [notice, setNotice] = useState<(CopyNoticeDetail & { id: number; x: number; y: number; atCursor: boolean }) | null>(null);

  useEffect(() => {
    let nextId = 0;
    let hideTimer = 0;
    function onPointerMove(event: PointerEvent) {
      pointer.current = { x: event.clientX, y: event.clientY };
    }
    function place() {
      const at = pointer.current;
      // The canvas viewport (and compare views) carry the dot grid.
      const canvases = [...document.querySelectorAll<HTMLElement>(".review-dot-grid")].map((element) => element.getBoundingClientRect());
      if (at && canvases.some((rect) => at.x >= rect.left && at.x <= rect.right && at.y >= rect.top && at.y <= rect.bottom)) {
        return { x: Math.min(at.x + 14, window.innerWidth - 290), y: Math.min(at.y + 18, window.innerHeight - 40), atCursor: true };
      }
      const canvas = canvases[0];
      const toolbar = document.querySelector<HTMLElement>('[aria-label="Canvas tools"]')?.getBoundingClientRect();
      if (toolbar) return { x: toolbar.left + toolbar.width / 2, y: toolbar.top - 10, atCursor: false };
      const area = canvas ?? { left: 0, width: window.innerWidth, bottom: window.innerHeight };
      return { x: area.left + area.width / 2, y: area.bottom - 72, atCursor: false };
    }
    function onNotice(event: Event) {
      event.preventDefault();
      const { message, tone, detail } = (event as CustomEvent<CopyNoticeDetail>).detail;
      window.clearTimeout(hideTimer);
      const id = ++nextId;
      setNotice((current) => {
        // "Copying…" then "Copied" stay in the same spot even if the cursor moved in between.
        const position = current && current.tone === "pending" ? { x: current.x, y: current.y, atCursor: current.atCursor } : place();
        return { id, message, tone, detail, ...position };
      });
      if (tone !== "pending") hideTimer = window.setTimeout(() => setNotice((current) => (current?.id === id ? null : current)), tone === "error" ? 4200 : 1800);
    }
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener(eventName, onNotice);
    return () => {
      window.clearTimeout(hideTimer);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener(eventName, onNotice);
    };
  }, []);

  if (!notice || typeof document === "undefined") return null;
  return createPortal(
    <div
      aria-live="polite"
      className="copy-notice dark-toast toast-surface pointer-events-none fixed z-[80]"
      data-centered={notice.atCursor ? undefined : ""}
      data-tone={notice.tone}
      key={notice.id}
      role="status"
      style={{ left: notice.x, top: notice.y, transform: notice.atCursor ? undefined : "translate(-50%, -100%)" }}
    >
      <span aria-hidden="true" className="dark-toast-icon">
        {notice.tone === "pending" ? (
          <svg className="size-3.5 animate-spin" fill="none" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.8" /><path d="M13.5 8A5.5 5.5 0 0 0 8 2.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>
        ) : notice.tone === "success" ? (
          <svg className="size-3.5" fill="none" viewBox="0 0 16 16"><path d="m3.75 8.25 2.75 2.75 5.75-6.25" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" /></svg>
        ) : (
          <svg className="size-3.5" fill="none" viewBox="0 0 16 16"><path d="M8 4.5v4M8 11.25v.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" /></svg>
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="dark-toast-title">{notice.message}</span>
        {notice.detail ? <span className="dark-toast-detail">{notice.detail}</span> : null}
      </span>
    </div>,
    document.body,
  );
}
