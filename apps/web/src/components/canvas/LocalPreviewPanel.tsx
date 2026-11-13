"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { CanvasFrameOption } from "./FrameNavigator";
import { formatPrecisePixelValue } from "./format-captured-measurement";

type PreviewMode = "side-by-side" | "overlay";

export function LocalPreviewPanel({
  workspaceId,
  handoffId,
  frames,
  selectedFrameId,
  onSelectFrame,
  onCommentOnScreen,
}: {
  workspaceId: string;
  handoffId: string;
  frames: CanvasFrameOption[];
  selectedFrameId: string | null;
  onSelectFrame: (frameId: string) => void;
  onCommentOnScreen: (frameId: string) => void;
}) {
  const storageKey = `asbir-handoff-local-preview:${workspaceId}:${handoffId}`;
  const [url, setUrl] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [mode, setMode] = useState<PreviewMode>("side-by-side");
  const [opacity, setOpacity] = useState(50);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const screens = useMemo(() => frames.filter((frame) => frame.kind === "frame"), [frames]);
  const frame = screens.find((candidate) => candidate.id === selectedFrameId) ?? screens[0] ?? null;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedUrl = window.localStorage.getItem(storageKey) ?? "";
      setUrl(savedUrl);
      setDraftUrl(savedUrl);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const scale = frame && stageSize.width > 0 && stageSize.height > 0
    ? Math.max(0.05, Math.min(
        (stageSize.width - 20) / (frame.sourceWidth * (mode === "side-by-side" ? 2 : 1) + (mode === "side-by-side" ? 16 : 0)),
        (stageSize.height - 18) / frame.sourceHeight,
        1,
      ))
    : 0.25;

  function saveUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const parsed = new URL(draftUrl.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Enter an HTTP or HTTPS development URL.");
      const normalized = parsed.toString();
      window.localStorage.setItem(storageKey, normalized);
      setUrl(normalized);
      setDraftUrl(normalized);
      setReloadKey((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enter a valid local URL.");
    }
  }

  function clearUrl() {
    window.localStorage.removeItem(storageKey);
    setUrl("");
    setDraftUrl("");
    setError(null);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-[#202020] p-3 text-[#d0d0d0]">
      <section aria-labelledby="local-preview-title" className="rounded-[6px] border border-[#3b3b3b] bg-[#252525] p-3">
        <h2 className="text-[12px] font-semibold text-[#ededed]" id="local-preview-title">Compare with your local app</h2>
        <p className="mt-1 text-[10px] leading-4 text-[#999]">The URL is saved in this browser only. Handoff does not upload your code or send this URL to the workspace.</p>
        <form className="mt-3 flex gap-1.5" onSubmit={saveUrl}>
          <label className="sr-only" htmlFor="local-preview-url">Local development URL</label>
          <input
            autoComplete="url"
            className="h-9 min-w-0 flex-1 rounded-[5px] border border-[#414141] bg-[#1b1b1b] px-2.5 font-mono text-[10px] text-[#eee] outline-none placeholder:text-[#a0a0a0] focus:border-[#929292]"
            id="local-preview-url"
            onChange={(event) => setDraftUrl(event.target.value)}
            placeholder="http://localhost:3000"
            type="url"
            value={draftUrl}
          />
          <button className="shrink-0 rounded-[5px] bg-[#444] px-2.5 text-[10px] font-medium text-white hover:bg-[#505050]" type="submit">Load</button>
        </form>
        {error ? <p className="mt-2 text-[10px] leading-4 text-[#f0a29c]" role="alert">{error}</p> : null}
        {url ? (
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono text-[9px] text-[#999]" title={url}>{url}</span>
            <div className="flex shrink-0 gap-1">
              <button className="rounded px-1.5 py-1 text-[9px] text-[#aaa] hover:bg-[#383838] hover:text-white" onClick={() => setReloadKey((current) => current + 1)} type="button">Reload</button>
              <button className="rounded px-1.5 py-1 text-[9px] text-[#aaa] hover:bg-[#383838] hover:text-white" onClick={clearUrl} type="button">Clear</button>
            </div>
          </div>
        ) : null}
      </section>

      {screens.length ? (
        <label className="flex items-center gap-2 text-[10px] text-[#aaa]" htmlFor="local-preview-screen">
          Screen
          <select
            className="h-8 min-w-0 flex-1 rounded-[5px] border border-[#393939] bg-[#282828] px-2 text-[10px] text-[#ddd]"
            id="local-preview-screen"
            onChange={(event) => onSelectFrame(event.target.value)}
            value={frame?.id ?? ""}
          >
            {screens.map((screen) => <option key={screen.id} value={screen.id}>{screen.name}</option>)}
          </select>
        </label>
      ) : null}

      <div className="flex shrink-0 items-center justify-between gap-2">
        <div aria-label="Comparison layout" className="flex rounded-[5px] bg-[#181818] p-0.5" role="group">
          {(["side-by-side", "overlay"] as const).map((option) => (
            <button
              aria-pressed={mode === option}
              className={"rounded-[4px] px-2 py-1 text-[9px] " + (mode === option ? "bg-[#3e3e3e] text-white" : "text-[#999] hover:text-white")}
              key={option}
              onClick={() => setMode(option)}
              type="button"
            >
              {option === "side-by-side" ? "Side by side" : "Overlay"}
            </button>
          ))}
        </div>
        {mode === "overlay" ? (
          <label className="flex min-w-0 items-center gap-2 text-[9px] text-[#999]">
            Local opacity
            <input aria-label="Local preview opacity" className="w-16 accent-[#d99a32]" max="100" min="10" onChange={(event) => setOpacity(Number(event.target.value))} type="range" value={opacity} />
          </label>
        ) : null}
      </div>

      <div className="relative min-h-[220px] flex-1 overflow-hidden rounded-[6px] border border-[#383838] bg-[#1b1b1b]" ref={stageRef}>
        {frame ? (
          <div className={"absolute inset-0 flex items-center justify-center " + (mode === "side-by-side" ? "gap-2 px-2" : "")}>
            {(mode === "side-by-side" ? ["reference", "local"] as const : ["overlay"] as const).map((layout) => (
              <div className="relative min-w-0 overflow-hidden rounded-[3px] border border-[#414141] bg-[#111]" key={layout} style={{ width: frame.sourceWidth * scale, height: frame.sourceHeight * scale }}>
                {layout !== "local" ? <Image alt={`Published reference: ${frame.name}`} className="pointer-events-none absolute left-0 top-0 max-w-none select-none" draggable={false} height={frame.pixelHeight} src={frame.imageSrc} style={{ width: frame.sourceWidth, height: frame.sourceHeight, transform: `scale(${scale})`, transformOrigin: "top left" }} unoptimized width={frame.pixelWidth} /> : null}
                {layout !== "reference" ? (
                  url ? <iframe
                    key={`${url}:${reloadKey}`}
                    className="absolute left-0 top-0 max-w-none border-0 bg-white"
                    height={frame.sourceHeight}
                    referrerPolicy="no-referrer"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    src={url}
                    style={{ width: frame.sourceWidth, height: frame.sourceHeight, opacity: mode === "overlay" ? opacity / 100 : 1, transform: `scale(${scale})`, transformOrigin: "top left" }}
                    title={`Local app preview: ${frame.name}`}
                  /> : <div className="absolute inset-0 grid place-items-center p-3 text-center text-[10px] leading-4 text-[#888]">Enter your development URL to load the local screen.</div>
                ) : null}
                <span className="pointer-events-none absolute left-1 top-1 z-10 rounded-[3px] bg-black/75 px-1.5 py-1 font-mono text-[8px] uppercase tracking-wide text-white">{layout === "overlay" ? "Reference + local" : layout}</span>
              </div>
            ))}
          </div>
        ) : <p className="absolute inset-0 grid place-items-center p-5 text-center text-[11px] leading-5 text-[#999]">This version has no screens to compare.</p>}
      </div>

      {frame ? (
        <div className="flex shrink-0 items-center justify-between gap-2">
          <p className="font-mono text-[9px] text-[#888]">{formatPrecisePixelValue(frame.sourceWidth)} × {formatPrecisePixelValue(frame.sourceHeight)} px</p>
          <button className="min-h-8 rounded-[5px] bg-[#353535] px-2.5 text-[10px] font-medium text-[#eee] hover:bg-[#454545]" onClick={() => onCommentOnScreen(frame.id)} type="button">Comment on this screen</button>
        </div>
      ) : null}
    </div>
  );
}
