"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { CanvasFrameOption } from "./FrameNavigator";
import { formatPrecisePixelValue } from "./format-captured-measurement";

type PreviewMode = "side-by-side" | "overlay";

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

  const gap = 24;
  const scale = frame && stageSize.width > 0 && stageSize.height > 0
    ? Math.max(0.05, Math.min(
        (stageSize.width - 48) / (frame.sourceWidth * (mode === "side-by-side" ? 2 : 1) + (mode === "side-by-side" ? gap : 0)),
        (stageSize.height - 48) / frame.sourceHeight,
        1,
      ))
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
        <h2 className="text-[14px] font-semibold" id="local-preview-title">Local preview</h2>
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
        {mode === "overlay" ? (
          <label className="flex items-center gap-2 text-[12px] text-foreground-subtle">
            Opacity
            <input aria-label="Local build opacity" className="w-24 accent-[var(--foreground)]" max="100" min="10" onChange={(event) => setOpacity(Number(event.target.value))} type="range" value={opacity} />
          </label>
        ) : null}
        <button aria-label="Close local preview" className="ml-auto grid size-9 place-items-center rounded-control text-foreground-subtle hover:bg-surface-raised hover:text-foreground" onClick={onClose} title="Close (Esc)" type="button">
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
              <div className="absolute inset-0 flex items-center justify-center" style={{ gap: mode === "side-by-side" ? gap * scale : 0 }}>
                {(mode === "side-by-side" ? ["Design", "Local"] as const : ["Design + local"] as const).map((layout) => (
                  <figure className="relative m-0 shrink-0" key={layout} style={{ width: frame.sourceWidth * scale, height: frame.sourceHeight * scale }}>
                    <figcaption className="absolute -top-6 left-0 text-[11px] text-foreground-subtle">{layout}</figcaption>
                    <div className="absolute inset-0 overflow-hidden rounded-[4px] bg-surface">
                      {layout !== "Local" ? <Image alt={`Design: ${frame.name}`} className="pointer-events-none absolute left-0 top-0 max-w-none select-none" draggable={false} height={frame.pixelHeight} src={frame.imageSrc} style={{ width: frame.sourceWidth, height: frame.sourceHeight, transform: `scale(${scale})`, transformOrigin: "top left" }} unoptimized width={frame.pixelWidth} /> : null}
                      {layout !== "Design" ? (
                        url ? <iframe
                          key={`${url}:${reloadKey}`}
                          className="absolute left-0 top-0 max-w-none border-0 bg-white"
                          height={frame.sourceHeight}
                          referrerPolicy="no-referrer"
                          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                          src={url}
                          style={{ width: frame.sourceWidth, height: frame.sourceHeight, opacity: mode === "overlay" ? opacity / 100 : 1, transform: `scale(${scale})`, transformOrigin: "top left" }}
                          title={`Local build: ${frame.name}`}
                        /> : layout === "Local" ? <p className="absolute inset-0 grid place-items-center p-4 text-center text-[12px] leading-5 text-foreground-subtle">Enter your local or test address above.</p> : null
                      ) : null}
                    </div>
                  </figure>
                ))}
              </div>
            ) : <p className="absolute inset-0 grid place-items-center p-5 text-center text-[13px] text-foreground-subtle">This version has no screens.</p>}
          </div>
          {frame ? (
            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2.5">
              <p className="min-w-0 truncate text-[12px] text-foreground-muted">
                <span className="text-foreground">{frame.name}</span>
                <span className="ml-2 font-mono text-foreground-subtle">{formatPrecisePixelValue(frame.sourceWidth)} × {formatPrecisePixelValue(frame.sourceHeight)}</span>
              </p>
              <button className="dial-button h-9 shrink-0 px-3.5 text-[12px]" onClick={() => { onClose(); onCommentOnScreen(frame.id); }} type="button">Comment on this screen</button>
            </footer>
          ) : null}
        </main>
      </div>
    </div>
  );
}
