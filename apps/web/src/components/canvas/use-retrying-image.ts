"use client";

import { useCallback, useEffect, useState } from "react";

const RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

/** Adds a retry marker so the browser fetches again instead of reusing a failed response. */
export function retryImageSrc(src: string, attempt: number) {
  if (attempt === 0) return src;
  return src + (src.includes("?") ? "&" : "?") + "retry=" + attempt;
}

/**
 * A screen render can fail to load during a network or Storage hiccup. Retry it a few times on its own,
 * again when the device comes back online, and let the viewer retry after that, instead of leaving a
 * broken image on the canvas.
 */
export function useRetryingImage(src: string) {
  const [state, setState] = useState({ src, attempt: 0, failed: false });
  // A new source (another version or screen) starts fresh.
  const current = state.src === src ? state : { src, attempt: 0, failed: false };

  const onError = useCallback(() => {
    setState((previous) => {
      const base = previous.src === src ? previous : { src, attempt: 0, failed: false };
      return { ...base, failed: true };
    });
  }, [src]);

  const retryNow = useCallback(() => {
    setState((previous) => {
      const base = previous.src === src ? previous : { src, attempt: 0, failed: false };
      return { src, attempt: base.attempt + 1, failed: false };
    });
  }, [src]);

  const exhausted = current.failed && current.attempt >= RETRY_DELAYS_MS.length;

  useEffect(() => {
    if (!current.failed || exhausted) return;
    const timer = window.setTimeout(retryNow, RETRY_DELAYS_MS[current.attempt]);
    return () => window.clearTimeout(timer);
  }, [current.failed, current.attempt, exhausted, retryNow]);

  useEffect(() => {
    if (!exhausted) return;
    window.addEventListener("online", retryNow);
    return () => window.removeEventListener("online", retryNow);
  }, [exhausted, retryNow]);

  return {
    src: retryImageSrc(src, current.attempt),
    /** Shown while waiting to retry and after the last automatic attempt. */
    failed: current.failed,
    exhausted,
    onError,
    retryNow,
  };
}
