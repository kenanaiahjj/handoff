"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { canvasTourEvent, canvasTourKey } from "./canvas-tour-state";

/** A step points at the first visible element carrying one of its `data-tour` names. */
type TourStep = {
  targets: string[];
  title: string;
  body: (target: string) => ReactNode;
};

type Rect = { left: number; top: number; width: number; height: number };

const Keys = ({ children }: { children: ReactNode }) => <span className="touch-hidden">{children}</span>;
const Click = () => <><span className="touch-hidden">Click</span><span className="touch-only">Tap</span></>;

function buildSteps({ canComment, canShare }: { canComment: boolean; canShare: boolean }): TourStep[] {
  return [
    {
      targets: ["modes"],
      title: "Pick a tool",
      body: () => (
        <>
          <strong className="font-medium text-foreground">View</strong><Keys> (V)</Keys> moves around without selecting.{" "}
          <strong className="font-medium text-foreground">Inspect</strong><Keys> (I)</Keys> shows any layer&apos;s size, spacing, colours and code.{" "}
          <strong className="font-medium text-foreground">Select</strong><Keys> (S)</Keys> drags a box over screens to export or link them together.
          {canComment ? <> <strong className="font-medium text-foreground">Comment</strong><Keys> (C)</Keys> pins feedback to a spot.</> : null}
        </>
      ),
    },
    {
      targets: ["navigate"],
      title: "Find your way around",
      body: () => (
        <>
          <span className="touch-hidden">Drag in View, or hold Space with any tool. ⌘ + scroll zooms, and the percentage fits every screen back in.</span>
          <span className="touch-only">Drag to move and pinch to zoom. Tap the percentage to fit every screen back in.</span>
        </>
      ),
    },
    {
      targets: ["screens"],
      title: "Every screen in one list",
      body: () => <>Jump to any screen, or search for text, colours and elements across the whole version<Keys> (⌘ F)</Keys>.</>,
    },
    {
      targets: ["changes"],
      title: "See what changed",
      body: () => <>Review changes walks through each changed screen next to the previous version. The Changes toggle marks edits right on the canvas.</>,
    },
    {
      targets: ["compare", "compare-more"],
      title: "Compare versions",
      body: (target) => (
        <>
          {target === "compare-more" ? "From More, " : ""}
          {target === "compare-more" ? "c" : "C"}ompare any two versions side by side, as an overlay, or as a pixel diff.
        </>
      ),
    },
    {
      targets: ["details"],
      title: "The details panel",
      body: () => <><Click /> something on a screen and its specs and code appear here, next to comments, notes and exports.</>,
    },
    ...(canShare
      ? [{
          targets: ["share"],
          title: "Share when it's ready",
          body: () => <>Publish makes this version live on the review link. Share controls who can open it.</>,
        }]
      : []),
  ];
}

function visibleTarget(name: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && !element.closest("[inert]")) return element;
  }
  return null;
}

/** The canvas is ready for a tour once its tools show and nothing (a welcome, a dialog) sits over it. */
function canvasReady() {
  const tools = visibleTarget("modes");
  if (!tools || document.querySelector('[aria-modal="true"], [data-comment-popover]')) return false;
  // The tools must be on top: the phone's screen-by-screen viewer, for one, covers the canvas.
  const box = tools.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return Boolean(hit && tools.contains(hit));
}

function readSeen() {
  try {
    return window.localStorage.getItem(canvasTourKey) === "done";
  } catch {
    return true;
  }
}

/**
 * A short first-run tour of the canvas: tools, moving around, screens, changes, compare, details
 * and sharing. It spotlights each control in turn, skips any that this canvas doesn't show, and runs
 * once per browser (More → Take the tour replays it).
 */
export function CanvasTour({ canComment, canShare }: { canComment: boolean; canShare: boolean }) {
  const [active, setActive] = useState(false);
  const [steps, setSteps] = useState<{ step: TourStep; target: string }[]>([]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardHeight, setCardHeight] = useState(180);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const start = useCallback(() => {
    const available = buildSteps({ canComment, canShare })
      .map((step) => ({ step, target: step.targets.find((name) => visibleTarget(name)) ?? "" }))
      .filter((entry) => entry.target);
    if (!available.length) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSteps(available);
    setIndex(0);
    setActive(true);
  }, [canComment, canShare]);

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(canvasTourKey, "done");
    } catch {
      // Without storage it may show again next time; nothing else depends on it.
    }
    setActive(false);
    setRect(null);
    returnFocusRef.current?.focus?.({ preventScroll: true });
  }, []);

  // First visit: wait until the canvas is actually on screen and free, then start after a beat.
  useEffect(() => {
    if (readSeen()) return;
    let readySince = 0;
    const interval = window.setInterval(() => {
      if (!canvasReady()) {
        readySince = 0;
        return;
      }
      readySince ||= Date.now();
      if (Date.now() - readySince < 1200) return;
      window.clearInterval(interval);
      start();
    }, 400);
    return () => window.clearInterval(interval);
  }, [start]);

  useEffect(() => {
    const replay = () => start();
    window.addEventListener(canvasTourEvent, replay);
    return () => window.removeEventListener(canvasTourEvent, replay);
  }, [start]);

  // Follow the target while it moves (layout changes, scrolling toolbars, resizes).
  useEffect(() => {
    if (!active) return;
    const current = steps[index];
    let frame = 0;
    const track = () => {
      const element = current ? visibleTarget(current.target) : null;
      if (element) {
        const box = element.getBoundingClientRect();
        setRect((previous) => previous && Math.abs(previous.left - box.left) < 0.5 && Math.abs(previous.top - box.top) < 0.5 && Math.abs(previous.width - box.width) < 0.5 && Math.abs(previous.height - box.height) < 0.5
          ? previous
          : { left: box.left, top: box.top, width: box.width, height: box.height });
      }
      frame = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(frame);
  }, [active, index, steps]);

  useLayoutEffect(() => {
    if (!active) return;
    const height = cardRef.current?.offsetHeight;
    if (height && height !== cardHeight) setCardHeight(height);
  }, [active, index, cardHeight]);

  useEffect(() => {
    if (active) nextRef.current?.focus({ preventScroll: true });
  }, [active, index]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish();
      } else if (event.key === "ArrowRight" && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        event.stopPropagation();
        if (index < steps.length - 1) setIndex(index + 1);
        else finish();
      } else if (event.key === "ArrowLeft" && index > 0 && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        event.stopPropagation();
        setIndex(index - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, finish, index, steps.length]);

  if (!active || !rect || !steps[index]) return null;

  const { step, target } = steps[index];
  const last = index === steps.length - 1;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const cardWidth = Math.min(300, viewportWidth - 24);
  const gap = 12;
  const pad = 4;
  const below = rect.top + rect.height + gap + cardHeight <= viewportHeight - 12;
  const above = rect.top - gap - cardHeight >= 12;
  // Tall targets (a side panel) leave no room above or below, so the card sits beside them instead.
  const besideRight = !below && !above && rect.left + rect.width + gap + cardWidth <= viewportWidth - 12;
  const besideLeft = !below && !above && !besideRight && rect.left - gap - cardWidth >= 12;
  const clampTop = (value: number) => Math.min(Math.max(12, value), viewportHeight - cardHeight - 12);
  const top = besideRight || besideLeft
    ? clampTop(rect.top + rect.height / 2 - cardHeight / 2)
    : below || !above
      ? Math.min(rect.top + rect.height + gap, viewportHeight - cardHeight - 12)
      : rect.top - gap - cardHeight;
  const left = besideRight
    ? rect.left + rect.width + gap
    : besideLeft
      ? rect.left - gap - cardWidth
      : Math.min(Math.max(12, rect.left + rect.width / 2 - cardWidth / 2), viewportWidth - cardWidth - 12);

  return (
    <div className="pointer-events-none fixed inset-0 z-[80]" data-dw-skip>
      <div
        aria-hidden="true"
        className="canvas-tour-spotlight absolute rounded-[10px]"
        style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
      />
      <div
        aria-describedby="canvas-tour-body"
        aria-labelledby="canvas-tour-title"
        className="dial-popover pointer-events-auto absolute p-4 motion-safe:transition-[left,top] motion-safe:duration-200 motion-safe:ease-out"
        ref={cardRef}
        role="dialog"
        style={{ left, top: Math.max(12, top), width: cardWidth }}
      >
        <p aria-live="polite" className="font-mono text-[10px] tabular-nums text-foreground-subtle">
          {index + 1} / {steps.length}
        </p>
        <h2 className="mt-1 text-[14px] font-semibold text-foreground" id="canvas-tour-title">{step.title}</h2>
        <p className="mt-1.5 text-[12px] leading-5 text-foreground-muted" id="canvas-tour-body">{step.body(target)}</p>
        {last ? <p className="mt-2 text-[11px] leading-4 text-foreground-subtle">Replay this tour any time from More.</p> : null}
        <div className="mt-4 flex items-center gap-2">
          <button className="mr-auto min-h-8 rounded-[7px] px-1.5 text-[12px] text-foreground-subtle hover:text-foreground" onClick={finish} type="button">
            {last ? "Close" : "Skip tour"}
          </button>
          {index > 0 ? (
            <button className="dial-button min-h-8 px-3 text-[12px]" onClick={() => setIndex(index - 1)} type="button">Back</button>
          ) : null}
          <button className="capture-primary-action min-h-8 px-3.5 text-[12px]" onClick={() => (last ? finish() : setIndex(index + 1))} ref={nextRef} type="button">
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
