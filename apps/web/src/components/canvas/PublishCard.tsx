"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DistortionWave } from "distortion-waves";
import { useWaveSettings } from "../motion/wave";

type Phase = "confirm" | "pending" | "live";

/**
 * Publish, in two views: a short confirmation, then the live review link. A distortion wave rises
 * from the Publish button and carries the card from one view to the other.
 */
export function PublishCard({
  versionLabel,
  onPublish,
  onClose,
}: {
  versionLabel: string;
  /** Resolves to the review link, or throws with a message to show. */
  onPublish: () => Promise<string>;
  onClose: () => void;
}) {
  const wave = useWaveSettings();
  const [phase, setPhase] = useState<Phase>("confirm");
  const [reviewUrl, setReviewUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const publishRef = useRef<HTMLButtonElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // On narrow screens the toolbar sits away from the edge, so the card spans the screen below it.
  const [narrowTop, setNarrowTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const anchor = cardRef.current?.parentElement;
      setNarrowTop(anchor && window.innerWidth < 640 ? anchor.getBoundingClientRect().bottom + 8 : null);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);
  // Labels can carry a name ("2.0.5 · Schedules"); the card only needs the number.
  const label = "v" + (versionLabel.split(" · ")[0] ?? versionLabel).replace(/^v/i, "").trim();

  useEffect(() => {
    publishRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || phase === "pending") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, phase]);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function publish() {
    setPhase("pending");
    setError("");
    try {
      const url = await onPublish();
      setReviewUrl(new URL(url, window.location.origin).toString());
      setPhase("live");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not publish this canvas.");
      setPhase("confirm");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(reviewUrl);
      setCopied(true);
    } catch {
      setError("Could not copy the link. Select it and copy it instead.");
    }
  }

  // Both views fill the card: it takes the taller view's height, so the shorter one must not leave a gap.
  const confirmView = (
    <div className="flex h-full flex-col bg-surface p-4">
      <h2 className="text-[14px] font-semibold text-foreground" id="publish-card-title">Publish {label}</h2>
      <p className="mt-1.5 text-[12px] leading-5 text-foreground-muted">
        Everyone with the review link sees this version from now on. You can publish a newer one later.
      </p>
      {error ? <p className="mt-2 text-[11px] leading-4 text-danger" role="alert">{error}</p> : null}
      <div className="mt-auto flex justify-end gap-2 pt-4">
        <button className="dial-button min-h-9 px-3 text-[12px]" disabled={phase === "pending"} onClick={onClose} type="button">
          Cancel
        </button>
        <button
          aria-busy={phase === "pending"}
          className="capture-primary-action min-h-9 px-4 text-[12px]"
          disabled={phase === "pending"}
          onClick={() => void publish()}
          ref={publishRef}
          type="button"
        >
          {phase === "pending" ? "Publishing…" : "Publish"}
        </button>
      </div>
    </div>
  );

  const liveView = (
    <div className="h-full bg-surface p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="grid size-6 place-items-center rounded-full bg-success/15 text-success">
          <svg className="size-3.5" fill="none" viewBox="0 0 16 16"><path d="m3.5 8.2 2.8 2.8 6.2-6.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /></svg>
        </span>
        <h2 className="text-[14px] font-semibold text-foreground" id="publish-card-live-title">{label} is live</h2>
      </div>
      <p className="mt-1.5 text-[12px] leading-5 text-foreground-muted">The review link is ready to share.</p>
      <div className="mt-3 flex min-w-0 items-center gap-1.5">
        <input
          aria-label="Review link"
          className="h-9 min-w-0 flex-1 truncate rounded-control border border-border bg-surface-inset px-2.5 font-mono text-[11px] text-foreground-muted"
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          value={reviewUrl}
        />
        <button className="dial-button min-h-9 shrink-0 px-3 text-[12px]" onClick={() => void copy()} ref={copyRef} type="button">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {error ? <p className="mt-2 text-[11px] leading-4 text-danger" role="alert">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <a className="dial-button inline-flex min-h-9 items-center px-3 text-[12px]" href={reviewUrl || undefined} rel="noreferrer" target="_blank">
          Open
        </a>
        <button className="capture-primary-action min-h-9 px-4 text-[12px]" onClick={onClose} type="button">
          Done
        </button>
      </div>
      <span aria-live="polite" className="sr-only">{copied ? "Review link copied." : ""}</span>
    </div>
  );

  return (
    <>
      <button aria-label="Close publish" className="fixed inset-0 z-40 cursor-default" onClick={() => (phase === "pending" ? null : onClose())} tabIndex={-1} type="button" />
      <div
        aria-labelledby={phase === "live" ? "publish-card-live-title" : "publish-card-title"}
        className={"z-50 overflow-hidden rounded-[14px] border border-border bg-surface shadow-[0_24px_64px_-12px_rgb(0_0_0/0.85)] " + (narrowTop === null ? "absolute right-0 top-full mt-2 w-[340px]" : "fixed inset-x-2")}
        ref={cardRef}
        role="dialog"
        style={narrowTop === null ? undefined : { top: narrowTop }}
      >
        <DistortionWave
          className="wave-capture"
          live={false}
          onFinish={(revealed) => { if (revealed) copyRef.current?.focus(); }}
          palette={wave.palette}
          reducedMotion={wave.reducedMotion}
          revealed={phase === "live"}
          revealedContent={liveView}
          source={publishRef}
          style={{ borderRadius: 14 }}
        >
          {confirmView}
        </DistortionWave>
      </div>
      <span aria-live="polite" className="sr-only">{phase === "live" ? `${label} is published.` : ""}</span>
    </>
  );
}
