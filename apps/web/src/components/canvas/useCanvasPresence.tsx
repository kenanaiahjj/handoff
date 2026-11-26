"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasFrameOption } from "./FrameNavigator";
import type { CanvasLayerView, CanvasPagePoint } from "./CanvasViewport";
import { screenAt } from "./useCanvasEyedropper";

export type PresenceViewer = {
  userId: string;
  name: string;
  image: string | null;
  versionId: string;
  screenId: string | null;
  x: number | null;
  y: number | null;
};

const heartbeatMs = 2500;
const colors = ["#FF8A3D", "#4C9AFF", "#36B37E", "#E5484D", "#A78BFA", "#F5C451", "#2EC4B6", "#F472B6"];

/** The same colour for a person on every screen and every visit. */
export function presenceColor(userId: string) {
  let hash = 0;
  for (const character of userId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "Someone";
}

/**
 * Live presence on the review canvas: every few seconds this sends where your pointer is and gets
 * back everyone else with the handoff open. Stops quietly for people who can't use it (guests on an
 * invite link) and while the tab is hidden.
 */
export function useCanvasPresence(endpoint: string | null, versionId: string, screens: readonly CanvasFrameOption[], fallbackScreenId: string | null) {
  const [viewers, setViewers] = useState<PresenceViewer[]>([]);
  const pointer = useRef<CanvasPagePoint | null>(null);
  const disabled = useRef(false);
  const latest = useRef({ screens, fallbackScreenId, versionId });
  useEffect(() => {
    latest.current = { screens, fallbackScreenId, versionId };
  });

  useEffect(() => {
    if (!endpoint) return;
    disabled.current = false;
    let active = true;
    let timer = 0;
    const beat = async () => {
      if (!active || disabled.current) return;
      if (document.visibilityState === "visible") {
        const point = pointer.current;
        const { screens: current, fallbackScreenId: fallback, versionId: version } = latest.current;
        const screenId = (point ? screenAt(current, point)?.id : null) ?? fallback;
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ versionId: version, screenId, x: point?.x ?? null, y: point?.y ?? null }),
          });
          if (response.status === 401 || response.status === 403 || response.status === 404) {
            disabled.current = true;
            setViewers([]);
            return;
          }
          if (response.ok && active) setViewers(((await response.json()) as { viewers?: PresenceViewer[] }).viewers ?? []);
        } catch {
          // Offline for a moment: keep the last list and try again.
        }
      }
      if (active) timer = window.setTimeout(beat, heartbeatMs);
    };
    void beat();
    const leave = () => {
      if (disabled.current) return;
      navigator.sendBeacon?.(endpoint, JSON.stringify({ versionId: latest.current.versionId, screenId: null, x: null, y: null, leaving: true }));
    };
    window.addEventListener("pagehide", leave);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [endpoint]);

  const onPointerPageMove = useCallback((point: CanvasPagePoint | null) => {
    pointer.current = point;
  }, []);

  /** Other people's pointers on this version, with their first name. */
  const overlay = useCallback((view: CanvasLayerView) => {
    const here = viewers.filter((viewer) => viewer.versionId === versionId && viewer.x !== null && viewer.y !== null);
    if (!here.length) return null;
    return here.map((viewer) => {
      const color = presenceColor(viewer.userId);
      return (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-40 transition-[left,top] duration-[2400ms] ease-linear motion-reduce:transition-none"
          key={viewer.userId}
          style={{ left: viewer.x! - view.originX, top: viewer.y! - view.originY }}
        >
          <div className="flex items-start" style={{ transform: `scale(${view.inverseScale})`, transformOrigin: "top left" }}>
            <svg className="size-4 drop-shadow" fill={color} stroke="white" strokeWidth="1.2" viewBox="0 0 16 16"><path d="M2 1.5 13.5 7 8 8.4 5.6 13.8 2 1.5Z" /></svg>
            <span className="mt-3 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium text-white shadow" style={{ backgroundColor: color }}>{firstName(viewer.name)}</span>
          </div>
        </div>
      );
    });
  }, [versionId, viewers]);

  return { viewers, onPointerPageMove, overlay };
}
