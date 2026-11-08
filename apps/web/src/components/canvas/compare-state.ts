export type CompareViewMode = "side-by-side" | "overlay" | "pixel-diff";

export type CompareRouteState = {
  fromVersionId: string;
  toVersionId: string;
  frameId: string | null;
  mode: CompareViewMode | null;
};

const compareViewModes = new Set<CompareViewMode>(["side-by-side", "overlay", "pixel-diff"]);

export function parseCompareRouteState(search: URLSearchParams): CompareRouteState | null {
  if (search.get("compare") !== "1") return null;
  const fromVersionId = search.get("compareFrom")?.trim() ?? "";
  const toVersionId = search.get("compareTo")?.trim() ?? "";
  if (!fromVersionId || !toVersionId || fromVersionId === toVersionId) return null;

  const requestedMode = search.get("compareMode") as CompareViewMode | null;
  return {
    fromVersionId,
    toVersionId,
    frameId: search.get("compareFrame") || null,
    mode: requestedMode && compareViewModes.has(requestedMode) ? requestedMode : null,
  };
}

export function updateCompareRouteUrl(href: string, state: CompareRouteState | null): string {
  const url = new URL(href);
  if (!state) {
    for (const key of ["compare", "compareFrom", "compareTo", "compareFrame", "compareMode"]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  }

  url.searchParams.set("compare", "1");
  url.searchParams.set("compareFrom", state.fromVersionId);
  url.searchParams.set("compareTo", state.toVersionId);
  url.searchParams.set("versionId", state.toVersionId);
  if (state.frameId) url.searchParams.set("compareFrame", state.frameId);
  else url.searchParams.delete("compareFrame");
  if (state.mode) url.searchParams.set("compareMode", state.mode);
  else url.searchParams.delete("compareMode");
  return url.toString();
}

type CompareResultLike = {
  diff: {
    fromVersionId: string;
    toVersionId: string;
    changes: Array<{ category: string }>;
  };
  frames: Array<{ frameId: string; status: string }>;
};

type ComparePairState<Result> = {
  fromVersionId: string;
  toVersionId: string;
  result: Result | null;
  error: string | null;
};

export function compareResultForPair<Result extends CompareResultLike>(
  initialResult: Result | null,
  state: ComparePairState<Result> | null,
  fromVersionId: string,
  toVersionId: string,
) {
  if (
    state?.fromVersionId === fromVersionId &&
    state.toVersionId === toVersionId &&
    state.result
  ) {
    return { result: state.result, error: state.error };
  }
  if (initialResult?.diff.fromVersionId === fromVersionId && initialResult.diff.toVersionId === toVersionId) {
    return { result: initialResult, error: null };
  }
  if (state?.fromVersionId === fromVersionId && state.toVersionId === toVersionId) {
    return { result: state.result, error: state.error };
  }
  return { result: null, error: null };
}

export function defaultCompareViewMode(result: Pick<CompareResultLike, "diff"> | null): CompareViewMode {
  const changes = result?.diff.changes ?? [];
  return changes.length > 0 && changes.every((change) => change.category === "visual")
    ? "pixel-diff"
    : "side-by-side";
}

export function preferredCompareFrameId(result: Pick<CompareResultLike, "frames"> | null) {
  const frames = result?.frames ?? [];
  return frames.find((frame) => frame.status !== "unchanged")?.frameId ?? frames[0]?.frameId ?? "";
}
