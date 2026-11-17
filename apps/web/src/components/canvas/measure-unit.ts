"use client";

import { useSyncExternalStore } from "react";
import { formatPixelValue } from "../../lib/format-pixel-value";

/**
 * How lengths are shown in the inspector. Figma works in points at 1x, so pt (iOS) and dp (Android)
 * are the same numbers as px with a different unit; rem divides by a 16 px root.
 */
export const measureUnits = ["px", "pt", "dp", "rem"] as const;
export type MeasureUnit = (typeof measureUnits)[number];

const storageKey = "asbir-measure-unit";
const changeEvent = "asbir:measure-unit";
const remBase = 16;

export function getMeasureUnit(): MeasureUnit {
  try {
    const stored = localStorage.getItem(storageKey);
    return measureUnits.includes(stored as MeasureUnit) ? (stored as MeasureUnit) : "px";
  } catch {
    return "px";
  }
}

export function setMeasureUnit(unit: MeasureUnit) {
  try {
    localStorage.setItem(storageKey, unit);
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
  currentOverride = unit;
  window.dispatchEvent(new Event(changeEvent));
}

let currentOverride: MeasureUnit | null = null;
const read = () => currentOverride ?? getMeasureUnit();

function subscribe(onChange: () => void) {
  window.addEventListener(changeEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The chosen unit; re-renders when it changes (here or in another tab). */
export function useMeasureUnit() {
  return useSyncExternalStore(subscribe, read, () => "px" as MeasureUnit);
}

/** A captured px length shown in the chosen unit, for example "16 pt" or "1 rem". */
export function formatLength(value: number, unit: MeasureUnit = read()) {
  if (!Number.isFinite(value)) return "—";
  if (unit === "rem") {
    const rem = Math.round((value / remBase) * 1000) / 1000;
    return `${Object.is(rem, -0) ? 0 : rem} rem`;
  }
  return `${formatPixelValue(value)} ${unit}`;
}

/** Same, without the unit suffix (for tight spots that already label the unit). */
export function formatLengthNumber(value: number, unit: MeasureUnit = read()) {
  return formatLength(value, unit).replace(/\s\S+$/, "");
}
