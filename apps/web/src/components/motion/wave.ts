import { useSyncExternalStore } from "react";
import type { PaletteLike } from "distortion-waves";

/**
 * Colours for the distortion waves (Publish and a reviewer's first look). The app's accent green keeps
 * them on brand; swap in "colorful", "ocean", "mono" or another hex to change every wave at once.
 */
export const wavePalette: PaletteLike = "#83a878";

export type WaveSettings = { palette: PaletteLike; reducedMotion: "system" | "always" };

/** Local testing only: the dev wave bar writes overrides here so every wave picks them up live. */
export const waveSettingsKey = "asbir:dev-wave-settings";
export const waveSettingsEvent = "asbir:dev-wave-settings";
/** Local testing only: plays the Publish wave with a pretend publish. */
export const devPublishDemoEvent = "asbir:dev-publish-demo";

const defaults: WaveSettings = { palette: wavePalette, reducedMotion: "system" };
let cachedRaw: string | null = null;
let cached: WaveSettings = defaults;

function readSettings(): WaveSettings {
  if (process.env.NODE_ENV !== "development") return defaults;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(waveSettingsKey);
  } catch {
    return defaults;
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    cached = raw ? { ...defaults, ...(JSON.parse(raw) as Partial<WaveSettings>) } : defaults;
  } catch {
    cached = defaults;
  }
  return cached;
}

function subscribe(onChange: () => void) {
  if (process.env.NODE_ENV !== "development") return () => {};
  window.addEventListener(waveSettingsEvent, onChange);
  return () => window.removeEventListener(waveSettingsEvent, onChange);
}

/** The wave palette and reduced-motion mode; outside local development always the defaults. */
export function useWaveSettings(): WaveSettings {
  return useSyncExternalStore(subscribe, readSettings, () => defaults);
}

export function writeWaveSettings(next: Partial<WaveSettings>) {
  try {
    window.localStorage.setItem(waveSettingsKey, JSON.stringify({ ...readSettings(), ...next }));
  } catch {
    // Private windows can refuse storage; the bar then only affects this page load's defaults.
  }
  window.dispatchEvent(new Event(waveSettingsEvent));
}
