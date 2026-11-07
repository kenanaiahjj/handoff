export type CompareViewMode = "side-by-side" | "overlay" | "pixel-diff";

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
