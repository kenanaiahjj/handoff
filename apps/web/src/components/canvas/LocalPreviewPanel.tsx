"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { CanvasFrameOption } from "./FrameNavigator";
import { formatPrecisePixelValue } from "./format-captured-measurement";

type PreviewMode = "side-by-side" | "overlay";

/** Viewports for the local build, like Chrome DevTools' device toolbar. Sizes are CSS pixels, portrait. */
const devices = [
  { group: "Desktop", id: "desktop-1920", name: "Desktop", width: 1920, height: 1080 },
  { group: "Desktop", id: "desktop-1440", name: "Desktop", width: 1440, height: 900 },
  { group: "Desktop", id: "laptop-1280", name: "Laptop", width: 1280, height: 800 },
  { group: "Tablet", id: "ipad-pro-13", name: "iPad Pro 13″", width: 1032, height: 1376 },
  { group: "Tablet", id: "ipad-air", name: "iPad Air", width: 820, height: 1180 },
  { group: "Tablet", id: "ipad-mini", name: "iPad mini", width: 744, height: 1133 },
  { group: "iPhone", id: "iphone-16-pro-max", name: "iPhone 16 Pro Max", width: 440, height: 956 },
  { group: "iPhone", id: "iphone-16-pro", name: "iPhone 16 Pro", width: 402, height: 874 },
  { group: "iPhone", id: "iphone-16", name: "iPhone 16", width: 393, height: 852 },
  { group: "iPhone", id: "iphone-se", name: "iPhone SE", width: 375, height: 667 },
  { group: "Android", id: "pixel-9-pro-xl", name: "Pixel 9 Pro XL", width: 412, height: 915 },
  { group: "Android", id: "pixel-9", name: "Pixel 9", width: 412, height: 923 },
  { group: "Android", id: "galaxy-s24", name: "Galaxy S24", width: 360, height: 780 },
  { group: "Android", id: "galaxy-s24-ultra", name: "Galaxy S24 Ultra", width: 384, height: 824 },
] as const;
type DeviceChoice = { id: string; width: number; height: number; landscape: boolean };

/** The device closest in width to a design screen, so a first visit starts somewhere sensible. */
function closestDevice(width: number): DeviceChoice {
  const best = devices.reduce((current, device) => Math.abs(device.width - width) < Math.abs(current.width - width) ? device : current);
  return { id: best.id, width: best.width, height: best.height, landscape: false };
}

function clampViewport(value: number) {
  return Math.max(200, Math.min(3840, Math.round(value) || 200));
}

/**
 * Full-screen check of a design screen against the team's local or test build. The URL stays in this
 * browser; the screen list on the left picks which design screen to compare against.
 */
export function LocalPreviewOverlay({
  workspaceId,
  handoffId,
  frames,
  selectedFrameId,
  onSelectFrame,
  onCommentOnScreen,
  onClose,
}: {
  workspaceId: string;
  handoffId: string;
  frames: CanvasFrameOption[];
  selectedFrameId: string | null;
  onSelectFrame: (frameId: string) => void;
  onCommentOnScreen: (frameId: string) => void;
  onClose: () => void;
}) {
  const storageKey = `asbir-handoff-local-preview:${workspaceId}:${handoffId}`;
  const [url, setUrl] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [mode, setMode] = useState<PreviewMode>("side-by-side");
  const [opacity, setOpacity] = useState(50);
  const [query, setQuery] = useState("");
  const [frameId, setFrameId] = useState(selectedFrameId);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // The local build's viewport is its own, not the design screen's size (a screen can be a navbar).
  const [device, setDevice] = useState<DeviceChoice | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const screens = useMemo(() => frames.filter((frame) => frame.kind === "frame"), [frames]);
  const frame = screens.find((candidate) => candidate.id === frameId) ?? screens[0] ?? null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return screens;
    return screens.filter((screen) => `${screen.name} ${screen.pageName ?? ""}`.toLowerCase().includes(needle));
  }, [query, screens]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedUrl = window.localStorage.getItem(storageKey) ?? "";
      setUrl(savedUrl);
      setDraftUrl(savedUrl);
      try {
        const saved = JSON.parse(window.localStorage.getItem(storageKey + ":device") ?? "null") as DeviceChoice | null;
        if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) setDevice(saved);
      } catch {
        // A damaged saved device just falls back to the closest one.
      }
      if (!savedUrl) urlRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const viewport = device ?? (frame ? closestDevice(frame.sourceWidth) : closestDevice(1440));
  const viewWidth = viewport.landscape ? viewport.height : viewport.width;
  const viewHeight = viewport.landscape ? viewport.width : viewport.height;

  function chooseDevice(next: DeviceChoice) {
    setDevice(next);
    try {
      window.localStorage.setItem(storageKey + ":device", JSON.stringify(next));
    } catch {
      // Storage blocked: the choice just isn't remembered.
    }
  }

  const gap = 24;
  // Design and local build share one scale, so their sizes stay comparable.
  const contentWidth = frame
    ? mode === "side-by-side" ? frame.sourceWidth + gap + viewWidth : Math.max(frame.sourceWidth, viewWidth)
    : 0;
  const contentHeight = frame ? Math.max(frame.sourceHeight, viewHeight) : 0;
  const scale = frame && stageSize.width > 0 && stageSize.height > 0
    ? Math.max(0.05, Math.min((stageSize.width - 48) / contentWidth, (stageSize.height - 72) / contentHeight, 1))
    : 0.25;

  function pick(id: string) {
    setFrameId(id);
    onSelectFrame(id);
  }

  function saveUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const parsed = new URL(draftUrl.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Enter an http or https address.");
      const normalized = parsed.toString();
      window.localStorage.setItem(storageKey, normalized);
      setUrl(normalized);
      setDraftUrl(normalized);
      setReloadKey((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error && cause.message.startsWith("Enter") ? cause.message : "Enter a full address, like http://localhost:3000.");
    }
  }

  return (
    <div aria-labelledby="local-preview-title" aria-modal="true" className="fixed inset-0 z-[70] flex flex-col bg-background text-foreground" role="dialog">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
        {/* On narrow screens the title and Close share the first row and the controls wrap below. */}
        <h2 className="text-[14px] font-semibold max-md:order-first max-md:flex-1" id="local-preview-title">Local preview</h2>
        <form className="flex min-w-0 flex-1 basis-72 items-center gap-2" onSubmit={saveUrl}>
          <label className="sr-only" htmlFor="local-preview-url">Local or test environment address</label>
          <input
            autoComplete="url"
            className="h-9 min-w-0 flex-1 rounded-control border border-border bg-surface-inset px-3 font-mono text-[12px] text-foreground outline-none placeholder:text-foreground-subtle focus:border-foreground-subtle"
            id="local-preview-url"
            onChange={(event) => setDraftUrl(event.target.value)}
            placeholder="http://localhost:3000"
            ref={urlRef}
            type="url"
            value={draftUrl}
          />
          <button className="h-9 shrink-0 rounded-control bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground hover:bg-primary-hover" type="submit">{url && draftUrl === url ? "Reload" : "Connect"}</button>
        </form>
        <div aria-label="Comparison layout" className="flex rounded-control bg-surface-inset p-0.5" role="group">
          {(["side-by-side", "overlay"] as const).map((option) => (
            <button
              aria-pressed={mode === option}
              className={"h-8 rounded-[7px] px-3 text-[12px] " + (mode === option ? "bg-surface-raised text-foreground" : "text-foreground-subtle hover:text-foreground")}
              key={option}
              onClick={() => setMode(option)}
              type="button"
            >
              {option === "side-by-side" ? "Side by side" : "Overlay"}
            </button>
          ))}
        </div>
        <div aria-label="Local build viewport" className="flex min-w-0 items-center gap-1.5 max-sm:w-full" role="group">
          <label className="sr-only" htmlFor="local-preview-device">Device</label>
          <select
            className="h-9 min-w-0 rounded-control border border-border bg-surface-inset px-2.5 text-[12px] text-foreground outline-none focus:border-foreground-subtle max-sm:flex-1"
            id="local-preview-device"
            onChange={(event) => {
              const preset = devices.find((entry) => entry.id === event.target.value);
              if (preset) chooseDevice({ id: preset.id, width: preset.width, height: preset.height, landscape: viewport.landscape });
              else chooseDevice({ ...viewport, id: "custom" });
            }}
            value={devices.some((entry) => entry.id === viewport.id) ? viewport.id : "custom"}
          >
            <option value="custom">Responsive</option>
            {(["Desktop", "Tablet", "iPhone", "Android"] as const).map((group) => (
              <optgroup key={group} label={group}>
                {devices.filter((entry) => entry.group === group).map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name} · {entry.width}×{entry.height}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {(["width", "height"] as const).map((side) => (
            <label className="flex items-center" key={side}>
              <span className="sr-only">{side === "width" ? "Viewport width" : "Viewport height"}</span>
              <input
                className="h-9 w-[4.25rem] rounded-control border border-border bg-surface-inset px-2 text-center font-mono text-[12px] tabular-nums text-foreground outline-none focus:border-foreground-subtle"
                inputMode="numeric"
                key={`${side}:${viewWidth}:${viewHeight}`}
                defaultValue={side === "width" ? viewWidth : viewHeight}
                onBlur={(event) => {
                  const value = clampViewport(Number(event.target.value));
                  const width = side === "width" ? value : viewWidth;
                  const height = side === "height" ? value : viewHeight;
                  if (width !== viewWidth || height !== viewHeight) chooseDevice({ id: "custom", width, height, landscape: false });
                  else event.target.value = String(side === "width" ? viewWidth : viewHeight);
                }}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                type="text"
              />
            </label>
          )).reduce<ReactNode[]>((parts, input, index) => index ? [...parts, <span aria-hidden="true" className="text-[11px] text-foreground-subtle" key="x">×</span>, input] : [input], [])}
          <button
            aria-label="Rotate the viewport"
            className="grid size-9 place-items-center rounded-control text-foreground-subtle hover:bg-surface-raised hover:text-foreground"
            onClick={() => chooseDevice({ ...viewport, landscape: !viewport.landscape })}
            title="Rotate"
            type="button"
          >
            <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16"><rect height="9" rx="1.5" width="6" x="2.5" y="4.5" /><path d="M10.5 3.5a3.5 3.5 0 0 1 3 3.5m0 0-1.2-1.2M13.5 7l1-1.3" /></svg>
          </button>
        </div>
        {mode === "overlay" ? (
          <label className="flex items-center gap-2 text-[12px] text-foreground-subtle">
            Opacity
            <input aria-label="Local build opacity" className="w-24 accent-[var(--foreground)]" max="100" min="10" onChange={(event) => setOpacity(Number(event.target.value))} type="range" value={opacity} />
          </label>
        ) : null}
        <button aria-label="Close local preview" className="ml-auto grid size-9 shrink-0 place-items-center max-md:order-first rounded-control text-foreground-subtle hover:bg-surface-raised hover:text-foreground" onClick={onClose} title="Close (Esc)" type="button">
          <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>
        </button>
        {error ? <p className="w-full text-[12px] text-danger" role="alert">{error}</p> : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside aria-label="Screens" className="flex max-h-48 shrink-0 flex-col border-b border-border md:max-h-none md:w-64 md:border-b-0 md:border-r">
          <div className="p-3">
            <label className="sr-only" htmlFor="local-preview-search">Search screens</label>
            <input
              className="h-9 w-full rounded-control border border-border bg-surface-inset px-3 text-[13px] text-foreground outline-none placeholder:text-foreground-subtle focus:border-foreground-subtle"
              id="local-preview-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${screens.length} screens`}
              type="search"
              value={query}
            />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {filtered.map((screen) => (
              <li key={screen.id}>
                <button
                  aria-current={screen.id === frame?.id ? "true" : undefined}
                  className={"flex w-full items-center gap-3 rounded-control px-2 py-1.5 text-left " + (screen.id === frame?.id ? "bg-surface-raised text-foreground" : "text-foreground-muted hover:bg-surface-raised/60 hover:text-foreground")}
                  onClick={() => pick(screen.id)}
                  type="button"
                >
                  <span className="relative h-10 w-8 shrink-0 overflow-hidden rounded-[5px] bg-surface-inset">
                    <Image alt="" className="object-cover object-top" fill sizes="32px" src={screen.imageSrc} unoptimized />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]">{screen.name}</span>
                    {screen.pageName ? <span className="block truncate text-[11px] text-foreground-subtle">{screen.pageName}</span> : null}
                  </span>
                </button>
              </li>
            ))}
            {!filtered.length ? <li className="px-2 py-4 text-[12px] text-foreground-subtle">No screens match “{query.trim()}”.</li> : null}
          </ul>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden bg-surface-inset" ref={stageRef}>
            {frame ? (
              <div className="absolute inset-0 flex items-start justify-center overflow-auto pt-10" style={{ gap: mode === "side-by-side" ? gap * scale : 0 }}>
                {(mode === "side-by-side" ? ["Design", "Local"] as const : ["Design + local"] as const).map((layout) => {
                  const width = layout === "Design" ? frame.sourceWidth : layout === "Local" ? viewWidth : Math.max(frame.sourceWidth, viewWidth);
                  const height = layout === "Design" ? frame.sourceHeight : layout === "Local" ? viewHeight : Math.max(frame.sourceHeight, viewHeight);
                  return (
                    <figure className="relative m-0 shrink-0" key={layout} style={{ width: width * scale, height: height * scale }}>
                      <figcaption className="absolute -top-6 left-0 max-w-full truncate whitespace-nowrap text-[11px] text-foreground-subtle">
                        {layout}
                        <span className="ml-1.5 font-mono tabular-nums">
                          {layout === "Design" ? `${formatPrecisePixelValue(frame.sourceWidth)} × ${formatPrecisePixelValue(frame.sourceHeight)}` : `${viewWidth} × ${viewHeight}`}
                        </span>
                      </figcaption>
                      <div className={"absolute inset-0 overflow-hidden rounded-[4px] " + (layout === "Design" ? "bg-surface" : "")}>
                        {layout !== "Local" ? <Image alt={`Design: ${frame.name}`} className="pointer-events-none absolute left-0 top-0 z-10 max-w-none select-none" draggable={false} height={frame.pixelHeight} src={frame.imageSrc} style={{ width: frame.sourceWidth, height: frame.sourceHeight, transform: `scale(${scale})`, transformOrigin: "top left", opacity: mode === "overlay" ? 1 - opacity / 100 : 1 }} unoptimized width={frame.pixelWidth} /> : null}
                        {layout !== "Design" ? (
                          url ? <iframe
                            key={`${url}:${reloadKey}`}
                            className="absolute left-0 top-0 max-w-none border-0 bg-white"
                            height={viewHeight}
                            referrerPolicy="no-referrer"
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                            src={url}
                            style={{ width: viewWidth, height: viewHeight, transform: `scale(${scale})`, transformOrigin: "top left" }}
                            title={`Local build at ${viewWidth} × ${viewHeight}`}
                            width={viewWidth}
                          /> : layout === "Local" ? <p className="absolute inset-0 grid place-items-center bg-surface p-4 text-center text-[12px] leading-5 text-foreground-subtle">Enter your local or test address above.</p> : null
                        ) : null}
                      </div>
                    </figure>
                  );
                })}
              </div>
            ) : <p className="absolute inset-0 grid place-items-center p-5 text-center text-[13px] text-foreground-subtle">This version has no screens.</p>}
          </div>
          {frame ? (
            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2.5">
              <p className="min-w-0 truncate text-[12px] text-foreground-muted">
                <span className="text-foreground">{frame.name}</span>
                <span className="ml-2 font-mono text-foreground-subtle">Design {formatPrecisePixelValue(frame.sourceWidth)} × {formatPrecisePixelValue(frame.sourceHeight)} · Local {viewWidth} × {viewHeight}</span>
              </p>
              <button className="dial-button h-9 shrink-0 px-3.5 text-[12px]" onClick={() => { onClose(); onCommentOnScreen(frame.id); }} type="button">Comment on this screen</button>
            </footer>
          ) : null}
        </main>
      </div>
    </div>
  );
}
