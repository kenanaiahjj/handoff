import type {
  SnapshotEnvelope,
  SnapshotFrame,
  SnapshotNode,
  VisualOnlySnapshot,
} from "@asbir/snapshot-contract";

export type DiffCategory =
  | "geometry"
  | "layout"
  | "style"
  | "text"
  | "token"
  | "structure"
  | "visual";

export type VersionSnapshot = SnapshotEnvelope | VisualOnlySnapshot;

export type SnapshotDiffChange = {
  frameId: string;
  sourceFileId: string;
  sourceNodeId: string | null;
  path: string;
  before: unknown;
  after: unknown;
  category: DiffCategory;
};

export type FrameDiff = {
  frameId: string;
  beforeFrameId: string | null;
  afterFrameId: string | null;
  sourceFileId: string;
  name: string;
  status: "added" | "removed" | "changed" | "unchanged";
};

export type FrameMatch = {
  beforeFrameId: string;
  afterFrameId: string;
};

export type NodeCandidate = {
  sourceNodeId: string;
  name: string;
  type: string;
  score: number;
};

export type CaptureCoverageDifference = {
  frameId: string;
  sourceFileId: string;
  path: string;
  availableIn: "before" | "after";
  nodeCount: number;
};

export type SnapshotDiff = {
  fromVersionId: string;
  toVersionId: string;
  frames: FrameDiff[];
  changes: SnapshotDiffChange[];
  captureCoverage: CaptureCoverageDifference[];
  unmatchedFrameCandidates: Array<{
    sourceFileId: string;
    beforeFrameId: string;
    beforeName: string;
    afterCandidates: Array<{ frameId: string; name: string; score: number }>;
  }>;
  unmatchedNodeCandidates: Array<{
    sourceFileId: string;
    frameId: string;
    beforeNodeId: string;
    beforeName: string;
    afterCandidates: NodeCandidate[];
  }>;
};

const sourcePayloadLayoutFields = new Set([
  "constraints",
  "counterAxisAlignContent",
  "counterAxisSizingMode",
  "counterAxisSpacing",
  "gridAutoTracks",
  "gridChildHorizontalAlign",
  "gridChildVerticalAlign",
  "gridColumnAnchorIndex",
  "gridColumnCount",
  "gridColumnGap",
  "gridColumnSizes",
  "gridColumnSpan",
  "gridItemsPositioning",
  "gridRowAnchorIndex",
  "gridRowCount",
  "gridRowGap",
  "gridRowSizes",
  "gridRowSpan",
  "itemSpacing",
  "layoutAlign",
  "layoutDirection",
  "layoutGrids",
  "layoutGrow",
  "layoutMode",
  "layoutPositioning",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
  "layoutWrap",
  "maxHeight",
  "maxWidth",
  "minHeight",
  "minWidth",
  "primaryAxisSizingMode",
  "strokesIncludedInLayout",
]);

const ignoredSourcePayloadDiffFields = new Set([
  "exportScale",
  "layerExportAssetKey",
  "layerExportContentType",
]);

type MutableCaptureCoverageDifference = Omit<CaptureCoverageDifference, "nodeCount"> & {
  nodeIds: Set<string>;
};

type CaptureCoverageCollector = Map<string, MutableCaptureCoverageDifference>;

type DiffInput = {
  versionId: string;
  snapshot: VersionSnapshot;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function equalValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => equalValue(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) {
    return false;
  }

  return leftKeys.every((key) => equalValue(left[key], right[key]));
}

function categoryForPath(path: string): DiffCategory {
  const root = path.split(/[.[]/, 1)[0];
  if (root === "bounds") return "geometry";
  if (["layout", "padding", "margins", "spacing"].includes(root)) return "layout";
  if (root === "sourcePayload") {
    const field = path.split(/[.[]/)[1];
    if (field && sourcePayloadLayoutFields.has(field)) return "layout";
  }
  if (root === "tokens") return "token";
  if (root === "typography" && /(^|\.)content(?:\.|$)/.test(path)) return "text";
  if (["fills", "strokes", "styleReferences", "typography"].includes(root)) return "style";
  if (root === "renderAsset") return "visual";
  return "structure";
}

function compareValue(
  before: unknown,
  after: unknown,
  path: string,
  frameId: string,
  sourceFileId: string,
  sourceNodeId: string | null,
  output: SnapshotDiffChange[],
) {
  if (equalValue(before, after)) return;

  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      compareValue(
        before[key],
        after[key],
        path ? `${path}.${key}` : key,
        frameId,
        sourceFileId,
        sourceNodeId,
        output,
      );
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      compareValue(
        before[index],
        after[index],
        `${path}[${index}]`,
        frameId,
        sourceFileId,
        sourceNodeId,
        output,
      );
    }
    return;
  }

  output.push({
    frameId,
    sourceFileId,
    sourceNodeId,
    path,
    before,
    after,
    category: categoryForPath(path),
  });
}

function compareSourcePayloadValue(
  before: unknown,
  after: unknown,
  path: string,
  frameId: string,
  sourceFileId: string,
  sourceNodeId: string,
  output: SnapshotDiffChange[],
  captureCoverage: CaptureCoverageCollector,
) {
  if (equalValue(before, after)) return;

  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      if (path === "sourcePayload" && ignoredSourcePayloadDiffFields.has(key)) continue;

      const hasBefore = Object.prototype.hasOwnProperty.call(before, key);
      const hasAfter = Object.prototype.hasOwnProperty.call(after, key);
      const nextPath = `${path}.${key}`;
      if (!hasBefore || !hasAfter) {
        const availableIn = hasBefore ? "before" : "after";
        const coverageKey = JSON.stringify([sourceFileId, frameId, nextPath, availableIn]);
        const existing = captureCoverage.get(coverageKey);
        if (existing) {
          existing.nodeIds.add(sourceNodeId);
        } else {
          captureCoverage.set(coverageKey, {
            frameId,
            sourceFileId,
            path: nextPath,
            availableIn,
            nodeIds: new Set([sourceNodeId]),
          });
        }
        continue;
      }

      compareSourcePayloadValue(
        before[key],
        after[key],
        nextPath,
        frameId,
        sourceFileId,
        sourceNodeId,
        output,
        captureCoverage,
      );
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) {
      output.push({
        frameId,
        sourceFileId,
        sourceNodeId,
        path,
        before,
        after,
        category: categoryForPath(path),
      });
      return;
    }

    for (let index = 0; index < before.length; index += 1) {
      compareSourcePayloadValue(
        before[index],
        after[index],
        `${path}[${index}]`,
        frameId,
        sourceFileId,
        sourceNodeId,
        output,
        captureCoverage,
      );
    }
    return;
  }

  output.push({
    frameId,
    sourceFileId,
    sourceNodeId,
    path,
    before,
    after,
    category: categoryForPath(path),
  });
}

function frameIdentity(sourceFileId: string, frameId: string) {
  return `${sourceFileId}\u0000${frameId}`;
}

function nodeIndex(nodes: SnapshotNode[]) {
  return new Map(nodes.map((node) => [node.sourceNodeId, node]));
}

function nodeCandidates(removed: SnapshotNode, added: SnapshotNode[]): NodeCandidate[] {
  return added
    .map((node) => ({
      sourceNodeId: node.sourceNodeId,
      name: node.name,
      type: node.type,
      score: node.name === removed.name && node.type === removed.type ? 1 : node.type === removed.type ? 0.5 : 0,
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.sourceNodeId.localeCompare(right.sourceNodeId));
}

function frameCandidates(
  removed: Pick<SnapshotFrame, "sourceFrameId" | "name">,
  added: Array<Pick<SnapshotFrame, "sourceFrameId" | "name">>,
) {
  return added
    .map((frame) => ({
      frameId: frame.sourceFrameId,
      name: frame.name,
      score: frame.name === removed.name ? 1 : 0,
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.frameId.localeCompare(right.frameId));
}

function assetMap(snapshot: VersionSnapshot) {
  return new Map(snapshot.assets.map((asset) => [asset.key, asset]));
}

function renderAssetSummary(snapshot: VersionSnapshot, frame: { renderAssetKey: string }) {
  const asset = assetMap(snapshot).get(frame.renderAssetKey);
  return asset ? { key: asset.key, sha256: asset.sha256 } : { key: frame.renderAssetKey, sha256: null };
}

function isVisualOnly(snapshot: VersionSnapshot): snapshot is VisualOnlySnapshot {
  return "visualOnly" in snapshot && snapshot.visualOnly;
}

function frameNodes(frame: SnapshotFrame | VisualOnlySnapshot["frames"][number]) {
  return "nodes" in frame ? frame.nodes : [];
}

function compareTokens(
  before: SnapshotNode["tokens"],
  after: SnapshotNode["tokens"],
  frameId: string,
  sourceFileId: string,
  sourceNodeId: string,
  output: SnapshotDiffChange[],
) {
  const beforeMap = new Map(before.map((token) => [token.sourceId, token]));
  const afterMap = new Map(after.map((token) => [token.sourceId, token]));
  const tokenIds = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();

  for (const tokenId of tokenIds) {
    const beforeToken = beforeMap.get(tokenId);
    const afterToken = afterMap.get(tokenId);
    const path = `tokens[${JSON.stringify(tokenId)}]`;
    if (!beforeToken || !afterToken) {
      output.push({
        frameId,
        sourceFileId,
        sourceNodeId,
        path,
        before: beforeToken,
        after: afterToken,
        category: "token",
      });
      continue;
    }

    compareValue(
      beforeToken,
      afterToken,
      path,
      frameId,
      sourceFileId,
      sourceNodeId,
      output,
    );
  }
}

function compareNode(
  before: SnapshotNode,
  after: SnapshotNode,
  frameId: string,
  sourceFileId: string,
  output: SnapshotDiffChange[],
  captureCoverage: CaptureCoverageCollector,
) {
  const { tokens: beforeTokens, sourcePayload: beforeSourcePayload, ...beforeRest } = before;
  const { tokens: afterTokens, sourcePayload: afterSourcePayload, ...afterRest } = after;
  compareValue(beforeRest, afterRest, "", frameId, sourceFileId, before.sourceNodeId, output);
  compareTokens(beforeTokens, afterTokens, frameId, sourceFileId, before.sourceNodeId, output);
  compareSourcePayloadValue(
    beforeSourcePayload,
    afterSourcePayload,
    "sourcePayload",
    frameId,
    sourceFileId,
    before.sourceNodeId,
    output,
    captureCoverage,
  );
}

function compareFrame(
  before: SnapshotFrame | VisualOnlySnapshot["frames"][number],
  after: SnapshotFrame | VisualOnlySnapshot["frames"][number],
  beforeSnapshot: VersionSnapshot,
  afterSnapshot: VersionSnapshot,
  frameId: string,
  sourceFileId: string,
  output: SnapshotDiffChange[],
  unmatchedNodeCandidates: SnapshotDiff["unmatchedNodeCandidates"],
  captureCoverage: CaptureCoverageCollector,
) {
  const beforeNodeMap = nodeIndex(frameNodes(before));
  const afterNodeMap = nodeIndex(frameNodes(after));
  const beforeNodes = [...beforeNodeMap.values()];
  const afterNodes = [...afterNodeMap.values()];

  if ("bounds" in before && "bounds" in after) {
    compareValue(before.bounds, after.bounds, "bounds", frameId, sourceFileId, null, output);
  }
  compareValue(before.name, after.name, "name", frameId, sourceFileId, null, output);
  if ("sourcePageId" in before && "sourcePageId" in after) {
    compareValue(before.sourcePageId, after.sourcePageId, "sourcePageId", frameId, sourceFileId, null, output);
  }

  const beforeRender = renderAssetSummary(beforeSnapshot, before);
  const afterRender = renderAssetSummary(afterSnapshot, after);
  if (!equalValue(beforeRender, afterRender)) {
    output.push({
      frameId,
      sourceFileId,
      sourceNodeId: null,
      path: "renderAsset",
      before: beforeRender,
      after: afterRender,
      category: "visual",
    });
  }

  const nodeIds = [...new Set([...beforeNodeMap.keys(), ...afterNodeMap.keys()])].sort();
  for (const sourceNodeId of nodeIds) {
    const beforeNode = beforeNodeMap.get(sourceNodeId);
    const afterNode = afterNodeMap.get(sourceNodeId);

    if (!beforeNode || !afterNode) {
      output.push({
        frameId,
        sourceFileId,
        sourceNodeId,
        path: "node",
        before: beforeNode,
        after: afterNode,
        category: "structure",
      });
      continue;
    }

    compareNode(beforeNode, afterNode, frameId, sourceFileId, output, captureCoverage);
  }

  const removedNodes = beforeNodes.filter((node) => !afterNodeMap.has(node.sourceNodeId));
  const addedNodes = afterNodes.filter((node) => !beforeNodeMap.has(node.sourceNodeId));
  for (const removedNode of removedNodes) {
    const candidates = nodeCandidates(removedNode, addedNodes);
    if (candidates.length) {
      unmatchedNodeCandidates.push({
        sourceFileId,
        frameId,
        beforeNodeId: removedNode.sourceNodeId,
        beforeName: removedNode.name,
        afterCandidates: candidates,
      });
    }
  }
}

export function diffSnapshots(
  from: DiffInput,
  to: DiffInput,
  options: { frameMatches?: FrameMatch[] } = {},
): SnapshotDiff {
  const fromFileId = from.snapshot.sourceFileId;
  const toFileId = to.snapshot.sourceFileId;
  const beforeFrames = from.snapshot.frames;
  const afterFrames = to.snapshot.frames;
  const beforeByKey = new Map(
    beforeFrames.map((frame) => [frameIdentity(fromFileId, frame.sourceFrameId), frame]),
  );
  const afterByKey = new Map(
    afterFrames.map((frame) => [frameIdentity(toFileId, frame.sourceFrameId), frame]),
  );
  const allKeys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort();
  const changes: SnapshotDiffChange[] = [];
  const frameDiffs: FrameDiff[] = [];
  const unmatchedNodeCandidates: SnapshotDiff["unmatchedNodeCandidates"] = [];
  const captureCoverage = new Map<string, MutableCaptureCoverageDifference>();
  const beforeById = new Map(beforeFrames.map((frame) => [frame.sourceFrameId, frame]));
  const afterById = new Map(afterFrames.map((frame) => [frame.sourceFrameId, frame]));
  const explicitPairs = (options.frameMatches ?? []).flatMap((match) => {
    const before = beforeById.get(match.beforeFrameId);
    const after = afterById.get(match.afterFrameId);
    const beforeKey = frameIdentity(fromFileId, match.beforeFrameId);
    const afterKey = frameIdentity(toFileId, match.afterFrameId);
    if (!before || !after || afterByKey.has(beforeKey) || beforeByKey.has(afterKey)) return [];
    return [{ before, after, beforeKey, afterKey }];
  });
  const explicitlyMatchedBefore = new Set(explicitPairs.map((pair) => pair.beforeKey));
  const explicitlyMatchedAfter = new Set(explicitPairs.map((pair) => pair.afterKey));

  for (const pair of explicitPairs) {
    const beforeChangeCount = changes.length;
    compareFrame(
      pair.before,
      pair.after,
      from.snapshot,
      to.snapshot,
      pair.after.sourceFrameId,
      toFileId,
      changes,
      unmatchedNodeCandidates,
      captureCoverage,
    );
    frameDiffs.push({
      frameId: pair.after.sourceFrameId,
      beforeFrameId: pair.before.sourceFrameId,
      afterFrameId: pair.after.sourceFrameId,
      sourceFileId: toFileId,
      name: pair.after.name,
      status: changes.length > beforeChangeCount ? "changed" : "unchanged",
    });
  }

  for (const key of allKeys) {
    if (explicitlyMatchedBefore.has(key) || explicitlyMatchedAfter.has(key)) continue;
    const before = beforeByKey.get(key);
    const after = afterByKey.get(key);
    const frame = before ?? after!;
    const sourceFileId = before ? fromFileId : toFileId;

    if (!before || !after) {
      frameDiffs.push({
        frameId: frame.sourceFrameId,
        beforeFrameId: before?.sourceFrameId ?? null,
        afterFrameId: after?.sourceFrameId ?? null,
        sourceFileId,
        name: frame.name,
        status: before ? "removed" : "added",
      });
      changes.push({
        frameId: frame.sourceFrameId,
        sourceFileId,
        sourceNodeId: null,
        path: "frame",
        before,
        after,
        category: "structure",
      });
      continue;
    }

    const beforeChangeCount = changes.length;
    compareFrame(
      before,
      after,
      from.snapshot,
      to.snapshot,
      frame.sourceFrameId,
      sourceFileId,
      changes,
      unmatchedNodeCandidates,
      captureCoverage,
    );
    frameDiffs.push({
      frameId: frame.sourceFrameId,
      beforeFrameId: before.sourceFrameId,
      afterFrameId: after.sourceFrameId,
      sourceFileId,
      name: after.name,
      status: changes.length > beforeChangeCount ? "changed" : "unchanged",
    });
  }

  const removedFrames = beforeFrames.filter(
    (frame) => !afterByKey.has(frameIdentity(fromFileId, frame.sourceFrameId)) &&
      !explicitlyMatchedBefore.has(frameIdentity(fromFileId, frame.sourceFrameId)),
  );
  const addedFrames = afterFrames.filter(
    (frame) => !beforeByKey.has(frameIdentity(toFileId, frame.sourceFrameId)) &&
      !explicitlyMatchedAfter.has(frameIdentity(toFileId, frame.sourceFrameId)),
  );
  const unmatchedFrameCandidates = removedFrames.flatMap((frame) => {
    const afterCandidates = frameCandidates(frame, addedFrames);
    return afterCandidates.length
      ? [
          {
            sourceFileId: fromFileId,
            beforeFrameId: frame.sourceFrameId,
            beforeName: frame.name,
            afterCandidates,
          },
        ]
      : [];
  });

  frameDiffs.sort((left, right) =>
    left.sourceFileId.localeCompare(right.sourceFileId) || left.frameId.localeCompare(right.frameId),
  );
  changes.sort(
    (left, right) =>
      left.sourceFileId.localeCompare(right.sourceFileId) ||
      left.frameId.localeCompare(right.frameId) ||
      (left.sourceNodeId ?? "").localeCompare(right.sourceNodeId ?? "") ||
      left.path.localeCompare(right.path),
  );

  return {
    fromVersionId: from.versionId,
    toVersionId: to.versionId,
    frames: frameDiffs,
    changes,
    captureCoverage: [...captureCoverage.values()]
      .map(({ nodeIds, ...difference }) => ({ ...difference, nodeCount: nodeIds.size }))
      .sort((left, right) =>
        left.sourceFileId.localeCompare(right.sourceFileId) ||
        left.frameId.localeCompare(right.frameId) ||
        left.path.localeCompare(right.path) ||
        left.availableIn.localeCompare(right.availableIn),
      ),
    unmatchedFrameCandidates,
    unmatchedNodeCandidates,
  };
}

export function isStructuredSnapshot(snapshot: VersionSnapshot): snapshot is SnapshotEnvelope {
  return !isVisualOnly(snapshot);
}
