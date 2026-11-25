import { useSyncExternalStore } from "react";
import type { PaletteLike } from "distortion-waves";

/**
 * Colours for the distortion waves: the app's dark surface (#212121) with Asbir orange (#ff8a3d)
 * running through it, and a white leading edge. The neutral colours are the surface itself, so the
 * band the wave lays over a panel stays dark instead of washing it grey. Swap in "mono", "sunset" or
 * another palette here to change every wave at once.
 */
export const wavePalette: PaletteLike = {
  colors: [[33, 33, 33], [255, 138, 61], [38, 38, 40], [33, 33, 33], [255, 162, 100], [44, 40, 38], [255, 138, 61]],
  ahead: [255, 255, 255],
  behind: [255, 138, 61],
};

export type WaveSettings = { palette: PaletteLike; reducedMotion: "system" | "always" };

/** Local testing only: the dev wave bar writes overrides here so every wave picks them up live. */
export const waveSettingsKey = "asbir:dev-wave-settings";
export const waveSettingsEvent = "asbir:dev-wave-settings";
/** Local testing only: plays the Publish wave with a pretend publish. */
export const devPublishDemoEvent = "asbir:dev-publish-demo";
/** Local testing only: plays the comments "All clear" wave without resolving anything. */
export const devAllClearEvent = "asbir:dev-all-clear";
/** Local testing only: shows the "version ready" view in the Add-a-version form with pretend data. */
export const devVersionReadyEvent = "asbir:dev-version-ready";
/** Local testing only: plays the "you're in" wave on the invite and onboarding pages. */
export const devJoinedEvent = "asbir:dev-joined";

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
    const saved = raw ? (JSON.parse(raw) as Partial<WaveSettings>) : {};
    // The bar saves a palette by name; "brand" (or an older saved copy of the colours) means ours.
    const palette = typeof saved.palette === "string" && saved.palette !== "brand" ? saved.palette : wavePalette;
    cached = { ...defaults, ...saved, palette };
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
