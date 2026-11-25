"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { devAllClearEvent, devJoinedEvent, devPublishDemoEvent, devVersionReadyEvent, useWaveSettings, wavePalette, writeWaveSettings } from "./wave";
import { reviewWelcomeCookie } from "../canvas/review-welcome-state";
import { canvasTourEvent, canvasTourKey } from "../canvas/canvas-tour-state";

const palettes: { label: string; value: string }[] = [
  { label: "Brand (dark + orange)", value: "brand" },
  { label: "Colorful", value: "colorful" },
  { label: "Green", value: "green" },
  { label: "Ocean", value: "ocean" },
  { label: "Sunset", value: "sunset" },
  { label: "Mono", value: "mono" },
];

const openKey = "asbir:dev-wave-bar-open";
const noSubscription = () => () => {};

/**
 * Local development only (never rendered in production builds): replays the Publish wave, the
 * reviewer welcome and the canvas tour, and switches the wave palette and reduced motion.
 */
export function WaveDevBar() {
  const pathname = usePathname();
  const wave = useWaveSettings();
  // The bar renders nothing until mounted, so reading storage here can't cause a hydration mismatch.
  const [open, setOpen] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(openKey) === "1";
    } catch {
      return false;
    }
  });
  // Which actions apply depends on what this page has mounted, so it is checked after render.
  const [onCanvas, setOnCanvas] = useState(false);
  const onReview = pathname.startsWith("/review/");
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);

  useEffect(() => {
    const check = () => setOnCanvas(Boolean(document.querySelector('[aria-label="Canvas tools"]')));
    check();
    const interval = window.setInterval(check, 1000);
    return () => window.clearInterval(interval);
  }, [pathname]);

  function toggle() {
    setOpen((current) => {
      try {
        window.localStorage.setItem(openKey, current ? "0" : "1");
      } catch {
        // Not remembered; fine for a dev tool.
      }
      return !current;
    });
  }

  function replayWelcome() {
    const reviewPath = pathname.split("/").slice(0, 3).join("/");
    document.cookie = `${reviewWelcomeCookie}=; Path=${reviewPath}; Max-Age=0; SameSite=Lax`;
    window.location.assign(reviewPath);
  }

  function replayTour() {
    try {
      window.localStorage.removeItem(canvasTourKey);
    } catch {
      // The event still starts it for this page.
    }
    window.dispatchEvent(new Event(canvasTourEvent));
  }

  if (!mounted) return null;

  const button = "min-h-8 rounded-[7px] px-2.5 text-left text-[12px] text-foreground hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:text-foreground-subtle disabled:hover:bg-transparent";

  return (
    <div className="fixed bottom-3 left-3 z-[75] flex flex-col items-start gap-2" data-dw-skip>
      {open ? (
        <div aria-label="Wave testing" className="dial-popover max-h-[calc(100dvh-64px)] w-60 overflow-y-auto p-2" role="group">
          <p className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">Local · waves and tour</p>
          <div className="flex flex-col">
            <button className={button} disabled={!onCanvas} onClick={() => window.dispatchEvent(new Event(devPublishDemoEvent))} title={onCanvas ? "Pretend publish: nothing is saved" : "Open a handoff canvas first"} type="button">
              Play the Publish wave
            </button>
            <button className={button} disabled={!onCanvas} onClick={() => window.dispatchEvent(new Event(devAllClearEvent))} title={onCanvas ? "Open the Comments panel first; plays without resolving anything" : "Open a canvas first"} type="button">
              Play the All clear wave
            </button>
            <button className={button} onClick={() => window.dispatchEvent(new Event(devVersionReadyEvent))} title="Needs the Add a version form on screen; nothing is created" type="button">
              Play the Version ready wave
            </button>
            <button className={button} onClick={() => window.dispatchEvent(new Event(devJoinedEvent))} title="Needs an invite or onboarding page; nothing is saved" type="button">
              Play the Joined wave
            </button>
            <button className={button} disabled={!onReview} onClick={replayWelcome} title={onReview ? "Clears the seen cookie and reloads" : "Open a /review link first"} type="button">
              Replay the reviewer welcome
            </button>
            <button className={button} disabled={!onCanvas} onClick={replayTour} title={onCanvas ? "Starts the tour from step one" : "Open a canvas first"} type="button">
              Replay the canvas tour
            </button>
          </div>
          <div className="mt-2 space-y-2 border-t border-border px-2.5 pb-1 pt-2.5">
            <label className="flex items-center justify-between gap-2 text-[12px] text-foreground-muted">
              Palette
              <select
                className="h-7 rounded-[6px] border border-border bg-surface-inset px-1.5 text-[12px] text-foreground"
                onChange={(event) => writeWaveSettings({ palette: event.target.value })}
                value={typeof wave.palette === "string" ? wave.palette : "brand"}
              >
                {palettes.map((palette) => <option key={palette.value} value={palette.value}>{palette.label}</option>)}
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 text-[12px] text-foreground-muted">
              Reduced motion (crossfade)
              <input
                checked={wave.reducedMotion === "always"}
                className="size-4 accent-[#ff8a3d]"
                onChange={(event) => writeWaveSettings({ reducedMotion: event.target.checked ? "always" : "system" })}
                type="checkbox"
              />
            </label>
          </div>
        </div>
      ) : null}
      <button
        aria-expanded={open}
        className="dial-popover flex h-8 items-center gap-1.5 px-3 text-[11px] font-medium text-foreground-muted hover:text-foreground"
        onClick={toggle}
        type="button"
      >
        <span aria-hidden="true" className="size-1.5 rounded-full bg-[#ff8a3d]" />
        Waves
      </button>
    </div>
  );
}
