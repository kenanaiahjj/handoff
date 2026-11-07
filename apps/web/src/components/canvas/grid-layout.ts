import { formatPixelValue } from "./format-captured-measurement";

type GridLayoutVisibilityInput = {
  mode: string | null;
  gridColumnCount: unknown;
  gridRowCount: unknown;
  gridColumnSizes: unknown;
  gridRowSizes: unknown;
};

export type CapturedGridTrack = {
  type: string;
  value: number | null;
};

export function capturedGridTracks(value: unknown): CapturedGridTrack[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      return [{ type: "FIXED", value: entry }];
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const track = entry as Record<string, unknown>;
    if (typeof track.type !== "string") return [];
    return [{
      type: track.type,
      value: typeof track.value === "number" && Number.isFinite(track.value) ? track.value : null,
    }];
  });
}

export function formatGridTrack(track: CapturedGridTrack) {
  if (track.type === "FLEX") return track.value === null ? "Flex" : `${String(track.value)}fr`;
  if (track.type === "HUG") return "Hug";
  if (track.type === "FIXED") return track.value === null ? "Fixed" : `${formatPixelValue(track.value)}px`;
  return track.value === null ? track.type : `${formatPixelValue(track.value)}px`;
}

function hasPositiveCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasSizes(value: unknown) {
  return capturedGridTracks(value).length > 0;
}

export function shouldShowGridLayout(input: GridLayoutVisibilityInput) {
  if (input.mode === "GRID") return true;
  if (input.mode !== null) return false;
  return hasPositiveCount(input.gridColumnCount)
    || hasPositiveCount(input.gridRowCount)
    || hasSizes(input.gridColumnSizes)
    || hasSizes(input.gridRowSizes);
}
