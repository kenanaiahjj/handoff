"use client";

import { useRef, useState, type ReactNode } from "react";
import { DistortionWave, type DistortionWaveHandle } from "distortion-waves";
import { useWaveSettings } from "../motion/wave";
import { reviewWelcomeCookie } from "./review-welcome-state";


/**
 * A reviewer's first look at a published version: what it is, what they can do, and Start review.
 * The canvas loads underneath (inert) meanwhile, and a distortion wave from the button carries the
 * reviewer into it. Shown once per version; the page skips it for deep links.
 */
export function ReviewWelcome({
  reviewPath,
  versionId,
  projectName,
  handoffName,
  versionLabel,
  publishedAt,
  releaseNote,
  previousVersionLabel,
  canComment,
  children,
}: {
  reviewPath: string;
  versionId: string;
  projectName: string;
  handoffName: string;
  versionLabel: string;
  publishedAt: string | null;
  releaseNote: string | null;
  previousVersionLabel: string | null;
  canComment: boolean;
  children: ReactNode;
}) {
  const wave = useWaveSettings();
  const [started, setStarted] = useState(false);
  const [opening, setOpening] = useState(false);
  const waveRef = useRef<DistortionWaveHandle>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [number, ...rest] = versionLabel.split(" · ");
  const versionName = rest.join(" · ");
  const published = publishedAt ? new Date(publishedAt) : null;

  async function start() {
    if (opening) return;
    setOpening(true);
    document.cookie = `${reviewWelcomeCookie}=${encodeURIComponent(versionId)}; Path=${reviewPath}; Max-Age=31536000; SameSite=Lax`;
    // Picture the canvas as it is now (it has been loading underneath), but never hold the reviewer up for it.
    await Promise.race([waveRef.current?.prepare(), new Promise((resolve) => window.setTimeout(resolve, 700))]).catch(() => null);
    setStarted(true);
  }

  const points: { icon: ReactNode; title: string; body: ReactNode }[] = [
    {
      icon: <path d="M4 2.5 12 8l-3.6.9L10.6 13l-1.5.7-2.2-4-2.9 2.4Z" strokeLinejoin="round" />,
      title: "Inspect anything",
      body: <><span className="touch-hidden">Click</span><span className="touch-only">Tap</span> an element to see its size, spacing, colours and code.</>,
    },
    canComment
      ? {
          icon: <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5V11h.5" strokeLinejoin="round" />,
          title: "Comment in place",
          body: "Pin feedback to the exact spot on a screen.",
        }
      : {
          icon: <><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2" /></>,
          title: "View only",
          body: "You can look around and inspect, but not comment.",
        },
    ...(previousVersionLabel
      ? [{
          icon: <path d="M2.5 5.5h9m-2.5-2.5 2.5 2.5-2.5 2.5M13.5 10.5h-9M7 8l-2.5 2.5L7 13" strokeLinecap="round" strokeLinejoin="round" />,
          title: "See what changed",
          body: `Changes since v${previousVersionLabel.split(" · ")[0]} are marked on the canvas.`,
        }]
      : []),
  ];

  return (
    <DistortionWave
      className="wave-capture h-full"
      live={false}
      onFinish={(revealed) => { if (revealed) canvasRef.current?.focus({ preventScroll: true }); }}
      palette={wave.palette}
      reducedMotion={wave.reducedMotion}
      ref={waveRef}
      revealed={started}
      revealedContent={(
        <div aria-label="Review canvas" className="h-full outline-none" ref={canvasRef} tabIndex={-1}>
          {children}
        </div>
      )}
      source={startRef}
    >
      <section aria-labelledby="review-welcome-title" className="h-full overflow-y-auto bg-background">
        <div className="mx-auto flex min-h-full w-full max-w-[440px] flex-col justify-center px-5 py-10">
          <p className="text-[12px] font-medium text-foreground-subtle">{projectName}</p>
          <h1 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground" id="review-welcome-title">
            {handoffName}
          </h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-foreground-muted">
            <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[11px] text-foreground">
              v{number.replace(/^v/i, "")}
            </span>
            {versionName ? <span className="text-foreground">{versionName}</span> : null}
            {published && !Number.isNaN(published.getTime()) ? (
              <span suppressHydrationWarning>
                Published {published.toLocaleDateString(undefined, { day: "numeric", month: "short", year: published.getFullYear() === new Date().getFullYear() ? undefined : "numeric" })}
              </span>
            ) : null}
          </p>

          {releaseNote ? (
            <figure className="mt-6 rounded-[12px] border border-border bg-surface p-4">
              <figcaption className="text-[11px] font-medium text-foreground-subtle">Note from the designer</figcaption>
              <blockquote className="mt-1.5 whitespace-pre-line text-[13px] leading-5 text-foreground">{releaseNote}</blockquote>
            </figure>
          ) : null}

          <ul className="mt-7 space-y-4">
            {points.map((point) => (
              <li className="flex gap-3" key={point.title}>
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-border bg-surface text-foreground-muted">
                  <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="1.3" viewBox="0 0 16 16">{point.icon}</svg>
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-foreground">{point.title}</span>
                  <span className="block text-[12px] leading-5 text-foreground-muted">{point.body}</span>
                </span>
              </li>
            ))}
          </ul>

          <button
            aria-busy={opening}
            className="capture-primary-action mt-9 min-h-11 w-full text-[13px] font-semibold"
            onClick={() => void start()}
            ref={startRef}
            type="button"
          >
            Start review
          </button>
        </div>
      </section>
    </DistortionWave>
  );
}
