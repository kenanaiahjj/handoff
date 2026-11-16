"use client";

import { useEffect } from "react";

/** Must match CACHE in public/sw.js. */
const deviceCacheName = "asbir-device-cache-v1";

/** Registers the service worker that keeps screen images and element details on this device. */
export function DeviceCacheRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}

/** Called on sign-out so another person on this computer doesn't inherit cached screens. */
export async function clearDeviceCache() {
  try {
    if ("caches" in window) await caches.delete(deviceCacheName);
  } catch {
    // Storage may be unavailable (private windows); nothing to clear then.
  }
}
