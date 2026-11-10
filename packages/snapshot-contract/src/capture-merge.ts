import type { Bounds, SnapshotAsset, SnapshotEnvelope, SnapshotFrame, SnapshotPayload } from "./schema.ts";

export type FigmaCaptureScope = "selected" | "page" | "file";
export type FrameReplacementMatch = { beforeFrameId: string; afterFrameId: string };

type PageLayoutEntry = Record<string, unknown> & {
  sourcePageId: string;
  offsetX: number;
  offsetY: number;
};

type CaptureFrameRef = Pick<SnapshotFrame, "sourceFrameId" | "sourcePageId" | "bounds" | "renderBounds">;

type CaptureSnapshotFields<TFrame extends CaptureFrameRef> = {
  frames: readonly TFrame[];
  sourceMetadata: Record<string, unknown>;
  canvasBounds?: Bounds;
};

export type FigmaCaptureMergePlan<TFrame extends CaptureFrameRef = SnapshotFrame> = {
  scope: Exclude<FigmaCaptureScope, "file">;
  frames: TFrame[];
  replacedFrameIds: string[];
  pageLayout: PageLayoutEntry[];
  pageOffsets: Map<string, { offsetX: number; offsetY: number }>;
  incomingOffsetDeltas: Map<string, { x: number; y: number }>;
  canvasBounds?: Bounds;
};

export function normalizeFigmaCaptureScope(value: unknown): FigmaCaptureScope | null {
  if (typeof value !== "string") return null;
  const scope = value.trim().toLowerCase();
  if (scope === "selected" || scope === "selected frames and components") return "selected";
  if (scope === "page" || scope === "all top-level frames and components on current page" || scope === "all top-level frames and components on the current page") return "page";
  if (scope === "file" || scope === "all top-level frames and components across all pages") return "file";
  return null;
}

function layoutEntries(value: unknown): PageLayoutEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.sourcePageId !== "string") return [];
    return [{
      ...record,
      sourcePageId: record.sourcePageId,
      offsetX: typeof record.offsetX === "number" && Number.isFinite(record.offsetX) ? record.offsetX : 0,
      offsetY: typeof record.offsetY === "number" && Number.isFinite(record.offsetY) ? record.offsetY : 0,
    }];
  });
}

function offsetMap(entries: readonly PageLayoutEntry[]) {
  return new Map(entries.map((entry) => [entry.sourcePageId, { offsetX: entry.offsetX, offsetY: entry.offsetY }] as const));
}

function numericRect(bounds: Bounds | undefined, offsetX = 0, offsetY = 0) {
  if (!bounds) return null;
  const x = bounds.x.value;
  const y = bounds.y.value;
  const width = bounds.width.value;
  const height = bounds.height.value;
  if ([x, y, width, height].some((value) => value === null || !Number.isFinite(value))) return null;
  if (width! < 0 || height! < 0) return null;
  return { x: x! + offsetX, y: y! + offsetY, width: width!, height: height! };
}

export function getFigmaCaptureOverviewClearRects(
  baselineFrames: readonly CaptureFrameRef[],
  replacedFrameIds: readonly string[],
  pageOffsets: ReadonlyMap<string, { offsetX: number; offsetY: number }>,
) {
  const replaced = new Set(replacedFrameIds);
  return baselineFrames.flatMap((frame) => {
    if (!replaced.has(frame.sourceFrameId)) return [];
    const offset = frame.sourcePageId ? pageOffsets.get(frame.sourcePageId) : undefined;
    const rect = numericRect(frame.renderBounds ?? frame.bounds, offset?.offsetX ?? 0, offset?.offsetY ?? 0);
    return rect ? [rect] : [];
  });
}

function measuredBounds(rect: { x: number; y: number; width: number; height: number }): Bounds {
  const measured = (value: number, property: string) => ({
    value,
    unit: "px",
    provenance: "measured" as const,
    sourceProperty: `mergedCapture.${property}`,
  });
  return {
    x: measured(rect.x, "x"),
    y: measured(rect.y, "y"),
    width: measured(rect.width, "width"),
    height: measured(rect.height, "height"),
  };
}

function unionRects(rectangles: Array<{ x: number; y: number; width: number; height: number }>) {
  if (!rectangles.length) return null;
  return rectangles.slice(1).reduce((current, next) => {
    const x = Math.min(current.x, next.x);
    const y = Math.min(current.y, next.y);
    return {
      x,
      y,
      width: Math.max(current.x + current.width, next.x + next.width) - x,
      height: Math.max(current.y + current.height, next.y + next.height) - y,
    };
  }, { ...rectangles[0] });
}

function mergePageLayout(
  baselineLayout: readonly PageLayoutEntry[],
  incomingLayout: readonly PageLayoutEntry[],
  frames: readonly CaptureFrameRef[],
) {
  const incomingById = new Map(incomingLayout.map((entry) => [entry.sourcePageId, entry] as const));
  const merged = baselineLayout.map((entry) => {
    const next = incomingById.get(entry.sourcePageId);
    const frameCount = frames.filter((frame) => frame.sourcePageId === entry.sourcePageId).length;
    if (!next) return { ...entry, frameCount };
    return {
      ...entry,
      ...next,
      offsetX: entry.offsetX,
      offsetY: entry.offsetY,
      frameCount,
    };
  });
  const known = new Set(baselineLayout.map((entry) => entry.sourcePageId));
  for (const entry of incomingLayout) {
    if (known.has(entry.sourcePageId)) continue;
    known.add(entry.sourcePageId);
    merged.push({
      ...entry,
      frameCount: frames.filter((frame) => frame.sourcePageId === entry.sourcePageId).length,
    });
  }
  return merged;
}

export function createFigmaCaptureMergePlan<TBaseline extends CaptureFrameRef, TIncoming extends CaptureFrameRef>(input: {
  baseline: CaptureSnapshotFields<TBaseline>;
  incoming: CaptureSnapshotFields<TIncoming>;
  frameMatches?: readonly FrameReplacementMatch[];
}): FigmaCaptureMergePlan<TBaseline | TIncoming> | null {
  const scope = normalizeFigmaCaptureScope(input.incoming.sourceMetadata.captureScope);
  if (scope !== "selected" && scope !== "page") return null;

  const baselineLayout = layoutEntries(input.baseline.sourceMetadata.pageLayout);
  const incomingLayout = layoutEntries(input.incoming.sourceMetadata.pageLayout);
  const baselineOffsets = offsetMap(baselineLayout);
  const incomingOffsets = offsetMap(incomingLayout);
  const incomingIds = new Set(input.incoming.frames.map((frame) => frame.sourceFrameId));
  const baselineIds = new Set(input.baseline.frames.map((frame) => frame.sourceFrameId));
  const incomingById = new Map(input.incoming.frames.map((frame) => [frame.sourceFrameId, frame] as const));
  const replacementByOldId = new Map<string, TIncoming>();
  const replacedFrameIds = new Set<string>();

  for (const frameId of incomingIds) {
    if (baselineIds.has(frameId)) {
      replacementByOldId.set(frameId, incomingById.get(frameId)!);
      replacedFrameIds.add(frameId);
    }
  }

  const usedBeforeIds = new Set<string>();
  const usedAfterIds = new Set<string>();
  for (const match of input.frameMatches ?? []) {
    const replacement = incomingById.get(match.afterFrameId);
    if (!replacement || !baselineIds.has(match.beforeFrameId) || usedBeforeIds.has(match.beforeFrameId) || usedAfterIds.has(match.afterFrameId)) {
      throw new Error("Frame replacement matches must point to distinct frames in the baseline and capture.");
    }
    usedBeforeIds.add(match.beforeFrameId);
    usedAfterIds.add(match.afterFrameId);
    replacementByOldId.set(match.beforeFrameId, replacement);
    replacedFrameIds.add(match.beforeFrameId);
  }

  const capturedPageIds = new Set(input.incoming.frames.flatMap((frame) => frame.sourcePageId ? [frame.sourcePageId] : []));
  if (scope === "page") {
    for (const frame of input.baseline.frames) {
      if (frame.sourcePageId && capturedPageIds.has(frame.sourcePageId)) replacedFrameIds.add(frame.sourceFrameId);
    }
  }

  const frames: Array<TBaseline | TIncoming> = [];
  const insertedIds = new Set<string>();
  const insertedPages = new Set<string>();
  for (const frame of input.baseline.frames) {
    const replacement = replacementByOldId.get(frame.sourceFrameId);
    if (replacement) {
      if (!insertedIds.has(replacement.sourceFrameId)) {
        frames.push(replacement);
        insertedIds.add(replacement.sourceFrameId);
      }
      continue;
    }
    if (scope === "page" && frame.sourcePageId && capturedPageIds.has(frame.sourcePageId)) {
      if (!insertedPages.has(frame.sourcePageId)) {
        for (const incomingFrame of input.incoming.frames) {
          if (incomingFrame.sourcePageId === frame.sourcePageId && !insertedIds.has(incomingFrame.sourceFrameId)) {
            frames.push(incomingFrame);
            insertedIds.add(incomingFrame.sourceFrameId);
          }
        }
        insertedPages.add(frame.sourcePageId);
      }
      continue;
    }
    frames.push(frame);
  }
  for (const frame of input.incoming.frames) {
    if (!insertedIds.has(frame.sourceFrameId)) {
      frames.push(frame);
      insertedIds.add(frame.sourceFrameId);
    }
  }

  const pageLayout = mergePageLayout(baselineLayout, incomingLayout, frames);
  const mergedOffsets = offsetMap(pageLayout);
  const incomingOffsetDeltas = new Map<string, { x: number; y: number }>();
  for (const pageId of capturedPageIds) {
    const oldOffset = incomingOffsets.get(pageId) ?? { offsetX: 0, offsetY: 0 };
    const mergedOffset = mergedOffsets.get(pageId) ?? oldOffset;
    incomingOffsetDeltas.set(pageId, {
      x: mergedOffset.offsetX - oldOffset.offsetX,
      y: mergedOffset.offsetY - oldOffset.offsetY,
    });
  }

  const canvasRects = [numericRect(input.baseline.canvasBounds)].filter((rect): rect is NonNullable<typeof rect> => rect !== null);
  const incomingPageIds = [...capturedPageIds];
  if (incomingPageIds.length === 1) {
    const pageId = incomingPageIds[0];
    const delta = incomingOffsetDeltas.get(pageId) ?? { x: 0, y: 0 };
    const rect = numericRect(input.incoming.canvasBounds, delta.x, delta.y);
    if (rect) canvasRects.push(rect);
  } else {
    for (const frame of input.incoming.frames) {
      const pageOffset = frame.sourcePageId ? mergedOffsets.get(frame.sourcePageId) : undefined;
      const rect = numericRect(frame.renderBounds ?? frame.bounds, pageOffset?.offsetX ?? 0, pageOffset?.offsetY ?? 0);
      if (rect) canvasRects.push(rect);
    }
  }
  const canvasRect = unionRects(canvasRects);

  return {
    scope,
    frames,
    replacedFrameIds: [...replacedFrameIds],
    pageLayout,
    pageOffsets: mergedOffsets,
    incomingOffsetDeltas,
    canvasBounds: canvasRect ? measuredBounds(canvasRect) : undefined,
  };
}

function referencedAssetKeys(frames: readonly SnapshotFrame[]) {
  const keys = new Set<string>();
  for (const frame of frames) {
    keys.add(frame.renderAssetKey);
    if (frame.vectorAssetKey) keys.add(frame.vectorAssetKey);
    for (const node of frame.nodes) {
      const key = node.sourcePayload.layerExportAssetKey;
      if (typeof key === "string") keys.add(key);
    }
  }
  return keys;
}

function fallbackFrameIds(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function warningList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function mergeFigmaCaptureSnapshots(input: {
  baseline: SnapshotEnvelope;
  incoming: SnapshotEnvelope;
  baselineVersionId: string;
  assetPrefix: string;
  frameMatches?: readonly FrameReplacementMatch[];
}): {
  snapshot: SnapshotPayload;
  incomingAssetKeyMap: Map<string, string>;
  inheritedAssetKeys: string[];
  replacedFrameIds: string[];
} | null {
  if (input.baseline.source !== "figma" || input.incoming.source !== "figma" || input.baseline.sourceFileId !== input.incoming.sourceFileId) {
    throw new Error("A partial Figma capture can only merge into a version from the same Figma file.");
  }
  const plan = createFigmaCaptureMergePlan({
    baseline: input.baseline,
    incoming: input.incoming,
    frameMatches: input.frameMatches,
  });
  if (!plan) return null;

  const retainedBaselineFrames = input.baseline.frames.filter((frame) => !plan.replacedFrameIds.includes(frame.sourceFrameId));
  const baselineReferences = referencedAssetKeys(retainedBaselineFrames);
  const incomingReferences = referencedAssetKeys(input.incoming.frames);
  incomingReferences.add(input.incoming.overviewAssetKey);
  const baselineAssets = input.baseline.assets.filter((asset) =>
    asset.key !== input.baseline.overviewAssetKey && baselineReferences.has(asset.key),
  );
  const incomingAssets = input.incoming.assets.filter((asset) => incomingReferences.has(asset.key));
  const prefix = input.assetPrefix.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48) || "capture";
  const incomingAssetKeyMap = new Map<string, string>();
  for (const asset of incomingAssets) incomingAssetKeyMap.set(asset.key, `merge-${prefix}-${asset.key}`);
  if (!incomingAssetKeyMap.has(input.incoming.overviewAssetKey)) throw new Error("The incoming Figma capture has no overview asset.");

  const incomingFrameIds = new Set(input.incoming.frames.map((frame) => frame.sourceFrameId));
  const frames = plan.frames.map((frame) => {
    if (!incomingFrameIds.has(frame.sourceFrameId)) return frame;
    return {
      ...frame,
      renderAssetKey: incomingAssetKeyMap.get(frame.renderAssetKey) ?? frame.renderAssetKey,
      ...(frame.vectorAssetKey ? { vectorAssetKey: incomingAssetKeyMap.get(frame.vectorAssetKey) ?? frame.vectorAssetKey } : {}),
      nodes: frame.nodes.map((node) => {
        const sourceKey = node.sourcePayload.layerExportAssetKey;
        if (typeof sourceKey !== "string" || !incomingAssetKeyMap.has(sourceKey)) return node;
        return {
          ...node,
          sourcePayload: { ...node.sourcePayload, layerExportAssetKey: incomingAssetKeyMap.get(sourceKey)! },
        };
      }),
    };
  });
  const assets: SnapshotAsset[] = [
    ...baselineAssets,
    ...incomingAssets.map((asset) => ({ ...asset, key: incomingAssetKeyMap.get(asset.key)! })),
  ];

  const baselineWarnings = warningList(input.baseline.sourceMetadata.captureWarnings);
  const incomingWarnings = warningList(input.incoming.sourceMetadata.captureWarnings);
  const replacedIds = new Set(plan.replacedFrameIds);
  const preservedFallbackIds = fallbackFrameIds(input.baseline.sourceMetadata.renderScaleFallbackFrameIds)
    .filter((frameId) => !replacedIds.has(frameId));
  const vectorCount = frames.filter((frame) => Boolean(frame.vectorAssetKey)).length;
  const layerExportCount = frames.reduce((count, frame) => count + frame.nodes.filter((node) => typeof node.sourcePayload.layerExportAssetKey === "string").length, 0);
  const pageIds = new Set(frames.flatMap((frame) => frame.sourcePageId ? [frame.sourcePageId] : []));
  const singlePageId = pageIds.size === 1 ? [...pageIds][0] : null;
  const incomingPageName = input.incoming.sourceMetadata.sourcePageName;
  const sourceMetadata: SnapshotPayload["sourceMetadata"] = {
    ...input.baseline.sourceMetadata,
    ...input.incoming.sourceMetadata,
    captureScope: input.baseline.sourceMetadata.captureScope ?? input.incoming.sourceMetadata.captureScope,
    lastCaptureScope: input.incoming.sourceMetadata.captureScope,
    sourcePageId: singlePageId,
    sourcePageName: singlePageId && typeof incomingPageName === "string" ? incomingPageName : null,
    pageLayout: plan.pageLayout as SnapshotPayload["sourceMetadata"][string],
    renderScaleFallbackFrameIds: [...new Set([
      ...preservedFallbackIds,
      ...fallbackFrameIds(input.incoming.sourceMetadata.renderScaleFallbackFrameIds),
    ])],
    captureWarnings: [...new Set([...baselineWarnings, ...incomingWarnings])],
    layerExportAssetCount: layerExportCount,
    vectorSourceFrameCount: vectorCount,
    vectorSourcePreserved: frames.length > 0 && vectorCount === frames.length,
    mergedFromVersionId: input.baselineVersionId,
    mergeScope: plan.scope,
    mergedFrameIds: input.incoming.frames.map((frame) => frame.sourceFrameId),
  };

  return {
    snapshot: {
      schemaVersion: input.incoming.schemaVersion,
      source: "figma",
      sourceFileId: input.incoming.sourceFileId,
      sourceRevisionId: input.incoming.sourceRevisionId,
      sourceFileName: input.incoming.sourceFileName,
      capturedAt: input.incoming.capturedAt,
      overviewAssetKey: incomingAssetKeyMap.get(input.incoming.overviewAssetKey)!,
      canvasBounds: plan.canvasBounds ?? input.incoming.canvasBounds ?? input.baseline.canvasBounds,
      frames,
      assets,
      sourceMetadata,
    },
    incomingAssetKeyMap,
    inheritedAssetKeys: baselineAssets.map((asset) => asset.key),
    replacedFrameIds: plan.replacedFrameIds,
  };
}
