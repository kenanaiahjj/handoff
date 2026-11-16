"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SnapshotNode } from "@asbir/snapshot-contract";

type FrameDetailsState = Record<string, SnapshotNode[] | "loading" | "error">;

/**
 * Loads full element details for one screen at a time and keeps them for the session.
 * The canvas renders from lightweight summaries; the inspector and agent brief call
 * `ensure(frameId)` and read `nodesFor(frameId)` once it arrives.
 */
export function useFrameNodeDetails(endpointForFrame: (frameId: string) => string) {
  const [details, setDetails] = useState<FrameDetailsState>({});
  const requested = useRef(new Set<string>());
  const endpointRef = useRef(endpointForFrame);
  useEffect(() => {
    endpointRef.current = endpointForFrame;
  }, [endpointForFrame]);

  const ensure = useCallback((frameId: string | null | undefined) => {
    if (!frameId || requested.current.has(frameId)) return;
    requested.current.add(frameId);
    setDetails((current) => ({ ...current, [frameId]: "loading" }));
    fetch(endpointRef.current(frameId))
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load element details.");
        const payload = await response.json() as { nodes?: SnapshotNode[] };
        setDetails((current) => ({ ...current, [frameId]: Array.isArray(payload.nodes) ? payload.nodes : [] }));
      })
      .catch(() => {
        // Allow a later retry (for example after reselecting the element).
        requested.current.delete(frameId);
        setDetails((current) => ({ ...current, [frameId]: "error" }));
      });
  }, []);

  const nodesFor = useCallback((frameId: string | null | undefined) => {
    const entry = frameId ? details[frameId] : undefined;
    return Array.isArray(entry) ? entry : null;
  }, [details]);

  const statusFor = useCallback((frameId: string | null | undefined): "idle" | "loading" | "error" | "ready" => {
    const entry = frameId ? details[frameId] : undefined;
    if (!entry) return "idle";
    return Array.isArray(entry) ? "ready" : entry;
  }, [details]);

  return { ensure, nodesFor, statusFor };
}
