"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasFrameOption } from "./FrameNavigator";
import type { CanvasLayerView, CanvasPagePoint, CanvasPageRect } from "./CanvasViewport";
import { screenAt } from "./useCanvasEyedropper";

export type PresenceViewer = {
  userId: string;
  name: string;
  image: string | null;
  versionId: string;
  screenId: string | null;
  x: number | null;
  y: number | null;
  /** The part of the page they can see (null from older clients). */
  view?: CanvasPageRect | null;
  /** Whose view they're following. */
  following?: string | null;
};

const heartbeatMs = 2500;
// While you follow someone, check on their view more often.
const followingHeartbeatMs = 1000;
// While someone follows you, send your view soon after it stops moving instead of waiting for the beat.
const settleCheckMs = 300;
const minimumBeatGapMs = 700;

function sameView(a: CanvasPageRect | null, b: CanvasPageRect | null) {
  if (!a || !b) return a === b;
  const tolerance = Math.max(a.width, a.height) * 0.002;
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance;
}
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
export function useCanvasPresence(
  endpoint: string | null,
  versionId: string,
  screens: readonly CanvasFrameOption[],
  fallbackScreenId: string | null,
  follow: { getView: () => CanvasPageRect | null; following: string | null } = { getView: () => null, following: null },
) {
  const [viewers, setViewers] = useState<PresenceViewer[]>([]);
  const [followers, setFollowers] = useState<string[]>([]);
  const pointer = useRef<CanvasPagePoint | null>(null);
  const disabled = useRef(false);
  const latest = useRef({ screens, fallbackScreenId, versionId, getView: follow.getView, following: follow.following });
  useEffect(() => {
    latest.current = { screens, fallbackScreenId, versionId, getView: follow.getView, following: follow.following };
  });
  // Lets a change of whom you follow, or a settled view while someone follows you, send a beat now.
  const beatNowRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!endpoint) return;
    disabled.current = false;
    let active = true;
    let timer = 0;
    let inFlight = false;
    let lastBeatAt = 0;
    let sentView: CanvasPageRect | null = null;
    let followedBy = 0;
    const beat = async () => {
      if (!active || disabled.current) return;
      window.clearTimeout(timer);
      if (inFlight) return;
      if (document.visibilityState === "visible") {
        const point = pointer.current;
        const { screens: current, fallbackScreenId: fallback, versionId: version, getView, following } = latest.current;
        const screenId = (point ? screenAt(current, point)?.id : null) ?? fallback;
        const view = getView();
        inFlight = true;
        lastBeatAt = Date.now();
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ versionId: version, screenId, x: point?.x ?? null, y: point?.y ?? null, view, following }),
          });
          sentView = view;
          if (response.status === 401 || response.status === 403 || response.status === 404) {
            disabled.current = true;
            setViewers([]);
            setFollowers([]);
            return;
          }
          if (response.ok && active) {
            const body = (await response.json()) as { viewers?: PresenceViewer[]; followers?: string[] };
            setViewers(body.viewers ?? []);
            const next = body.followers ?? [];
            followedBy = next.length;
            setFollowers((previous) => previous.length === next.length && previous.every((id, index) => id === next[index]) ? previous : next);
          }
        } catch {
          // Offline for a moment: keep the last list and try again.
        } finally {
          inFlight = false;
        }
      }
      if (active) timer = window.setTimeout(beat, latest.current.following ? followingHeartbeatMs : heartbeatMs);
    };
    beatNowRef.current = () => void beat();
    void beat();
    // Only while someone follows you: send your view once it has stopped moving. Reading the view is
    // a little arithmetic, so this costs nothing when nobody is following.
    let previousView: CanvasPageRect | null = null;
    const settleTimer = window.setInterval(() => {
      if (!followedBy || inFlight || document.visibilityState !== "visible") return;
      const view = latest.current.getView();
      const settled = sameView(view, previousView);
      previousView = view;
      if (settled && !sameView(view, sentView) && Date.now() - lastBeatAt >= minimumBeatGapMs) void beat();
    }, settleCheckMs);
    const leave = () => {
      if (disabled.current) return;
      navigator.sendBeacon?.(endpoint, JSON.stringify({ versionId: latest.current.versionId, screenId: null, x: null, y: null, leaving: true }));
    };
    window.addEventListener("pagehide", leave);
    return () => {
      active = false;
      beatNowRef.current = () => undefined;
      window.clearTimeout(timer);
      window.clearInterval(settleTimer);
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

  // Starting or stopping a follow tells the other person straight away.
  useEffect(() => {
    beatNowRef.current();
  }, [follow.following]);

  return { viewers, followers, onPointerPageMove, overlay };
}
