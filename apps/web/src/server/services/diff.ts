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
  sourceNodeName?: string | null;
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

export type SnapshotSourceIdentity = "exact" | "inferred" | "different";

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
  sourceIdentity: SnapshotSourceIdentity;
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

const normalizedSourcePayloadLayoutFields = new Set([
  "constraints",
  "counterAxisAlignContent",
  "counterAxisSizingMode",
  "counterAxisSpacing",
  "gridColumnCount",
  "gridColumnGap",
  "gridRowCount",
  "gridRowGap",
  "itemSpacing",
  "layoutAlign",
  "layoutDirection",
  "layoutGrow",
  "layoutMode",
  "layoutPositioning",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
  "layoutWrap",
  "primaryAxisSizingMode",
]);

const ignoredSourcePayloadDiffFields = new Set([
  "exportScale",
  "layerExportAssetKey",
  "layerExportContentType",
]);

function isFigmaStyleIdPath(path: string) {
  return (
    /^(?:fills|strokes|styleReferences)\[\d+\]\.sourceStyleId$/.test(path) ||
    /^sourcePayload\.textSegments\[\d+\]\.(?:textStyleId|fillStyleId)$/.test(path) ||
    /^sourcePayload\.(?:fillPaintDetails|strokePaintDetails)\[\d+\]\.styleId$/.test(path)
  );
}

function withoutFigmaStyleIds(value: unknown, path = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => withoutFigmaStyleIds(entry, `${path}[${index}]`));
  }
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const nextPath = path ? `${path}.${key}` : key;
      return isFigmaStyleIdPath(nextPath)
        ? []
        : [[key, withoutFigmaStyleIds(entry, nextPath)]];
    }),
  );
}

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
    if (field === "textSegments") {
      if (/^sourcePayload\.textSegments\[\d+\]\.characters(?:\.|$)/.test(path)) return "text";
      if (/^sourcePayload\.textSegments\[\d+\]\.(?:fills(?:\[|\.|$)|fontName|fontSize|fontWeight|lineHeight|letterSpacing|textAlign)(?:\.|$)/.test(path)) {
        return "style";
      }
      if (/^sourcePayload\.textSegments\[\d+\]\.boundVariables(?:\.|$)/.test(path)) return "token";
    }
    if (field && sourcePayloadLayoutFields.has(field)) return "layout";
    if (field === "boundVariables") return "token";
    if (["fillPaintDetails", "strokePaintDetails", "strokeWeight"].includes(field)) return "style";
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
  if (
    typeof before === "number" &&
    typeof after === "number" &&
    Math.abs(before - after) < 0.0001 &&
    /^(?:bounds|padding|margins|spacing|typography)(?:\.|\[).+\.value$/.test(path)
  ) {
    return;
  }
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

function withoutRedundantSourcePayloadFields(value: unknown, path = "sourcePayload"): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => withoutRedundantSourcePayloadFields(entry, `${path}[${index}]`));
  }
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (key === "boundVariables") return [];
      if (path === "sourcePayload" && normalizedSourcePayloadLayoutFields.has(key)) return [];
      if (/^sourcePayload\.textSegments\[\d+\]$/.test(path) && ["start", "end"].includes(key)) return [];
      return [[key, withoutRedundantSourcePayloadFields(entry, `${path}.${key}`)]];
    }),
  );
}

function frameIdentity(sourceFileId: string, frameId: string) {
  return `${sourceFileId}\u0000${frameId}`;
}

function nodeIndex(nodes: SnapshotNode[]) {
  return new Map(nodes.map((node) => [node.sourceNodeId, node]));
}

type MatchedNodePair = { before: SnapshotNode; after: SnapshotNode };

function nodeMatchKey(node: SnapshotNode) {
  return `${node.type}\u0000${node.name}`;
}

function childrenByParent(nodes: SnapshotNode[]) {
  const result = new Map<string | null, SnapshotNode[]>();
  for (const node of nodes) {
    const parentId = node.parentSourceNodeId ?? null;
    const children = result.get(parentId) ?? [];
    children.push(node);
    result.set(parentId, children);
  }
  return result;
}

function matchFrameNodes(
  beforeNodes: SnapshotNode[],
  afterNodes: SnapshotNode[],
  beforeFrameId: string,
  afterFrameId: string,
) {
  const beforeById = nodeIndex(beforeNodes);
  const afterById = nodeIndex(afterNodes);
  const beforeChildren = childrenByParent(beforeNodes);
  const afterChildren = childrenByParent(afterNodes);
  const pairs: MatchedNodePair[] = [];
  const matchedBeforeIds = new Set<string>();
  const matchedAfterIds = new Set<string>();

  function pair(before: SnapshotNode, after: SnapshotNode) {
    if (matchedBeforeIds.has(before.sourceNodeId) || matchedAfterIds.has(after.sourceNodeId)) return false;
    matchedBeforeIds.add(before.sourceNodeId);
    matchedAfterIds.add(after.sourceNodeId);
    pairs.push({ before, after });
    return true;
  }

  for (const before of beforeNodes) {
    const after = afterById.get(before.sourceNodeId);
    if (after) pair(before, after);
  }
  const beforeRoot = beforeById.get(beforeFrameId);
  const afterRoot = afterById.get(afterFrameId);
  if (beforeRoot && afterRoot) pair(beforeRoot, afterRoot);

  function matchByMatchedParents() {
    for (let index = 0; index < pairs.length; index += 1) {
      const parentPair = pairs[index];
      const oldChildren = beforeChildren.get(parentPair.before.sourceNodeId) ?? [];
      const newChildren = afterChildren.get(parentPair.after.sourceNodeId) ?? [];
      const newChildrenByKey = new Map<string, SnapshotNode[]>();

      for (const child of newChildren) {
        if (matchedAfterIds.has(child.sourceNodeId)) continue;
        const key = nodeMatchKey(child);
        const candidates = newChildrenByKey.get(key) ?? [];
        candidates.push(child);
        newChildrenByKey.set(key, candidates);
      }

      for (const child of oldChildren) {
        if (matchedBeforeIds.has(child.sourceNodeId)) continue;
        const candidates = newChildrenByKey.get(nodeMatchKey(child));
        const candidate = candidates?.shift();
        if (candidate) pair(child, candidate);
      }
    }
  }

  // Prefer exact node IDs, then preserve sibling hierarchy by matching type and name.
  matchByMatchedParents();

  // A copied or rebuilt Figma frame can regenerate every node ID and reparent layers.
  // Match remaining identical layer labels in traversal order to avoid reporting the
  // whole screen as deleted and re-added.
  const newNodesByKey = new Map<string, SnapshotNode[]>();
  for (const after of afterNodes) {
    if (matchedAfterIds.has(after.sourceNodeId)) continue;
    const key = nodeMatchKey(after);
    const candidates = newNodesByKey.get(key) ?? [];
    candidates.push(after);
    newNodesByKey.set(key, candidates);
  }
  for (const before of beforeNodes) {
    if (matchedBeforeIds.has(before.sourceNodeId)) continue;
    const candidate = newNodesByKey.get(nodeMatchKey(before))?.shift();
    if (candidate) pair(before, candidate);
  }
  matchByMatchedParents();

  // When the same parent keeps one layer of a type but renames it, retain the
  // relationship so the diff can report the changed label or content.
  for (let index = 0; index < pairs.length; index += 1) {
    const parentPair = pairs[index];
    const oldGroups = new Map<string, SnapshotNode[]>();
    const newGroups = new Map<string, SnapshotNode[]>();
    for (const child of beforeChildren.get(parentPair.before.sourceNodeId) ?? []) {
      if (matchedBeforeIds.has(child.sourceNodeId)) continue;
      const candidates = oldGroups.get(child.type) ?? [];
      candidates.push(child);
      oldGroups.set(child.type, candidates);
    }
    for (const child of afterChildren.get(parentPair.after.sourceNodeId) ?? []) {
      if (matchedAfterIds.has(child.sourceNodeId)) continue;
      const candidates = newGroups.get(child.type) ?? [];
      candidates.push(child);
      newGroups.set(child.type, candidates);
    }
    for (const [type, oldGroup] of oldGroups) {
      const newGroup = newGroups.get(type);
      if (!newGroup || oldGroup.length !== newGroup.length) continue;
      for (let childIndex = 0; childIndex < oldGroup.length; childIndex += 1) {
        pair(oldGroup[childIndex], newGroup[childIndex]);
      }
    }
  }
  matchByMatchedParents();

  return {
    pairs,
    removed: beforeNodes.filter((node) => !matchedBeforeIds.has(node.sourceNodeId)),
    added: afterNodes.filter((node) => !matchedAfterIds.has(node.sourceNodeId)),
  };
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
  type TokenBinding = SnapshotNode["tokens"][number];
  const identity = (token: TokenBinding) => token.bindingPath
    ? `binding:${token.bindingPath}`
    : `fallback:${token.category ?? "other"}:${token.collectionName ?? ""}:${token.name}:${token.mode ?? ""}`;
  const group = (tokens: TokenBinding[]) => {
    const grouped = new Map<string, TokenBinding[]>();
    for (const token of tokens) {
      const key = identity(token);
      grouped.set(key, [...(grouped.get(key) ?? []), token]);
    }
    return grouped;
  };
  const beforeMap = group(before);
  const afterMap = group(after);
  const tokenIds = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();

  for (const tokenId of tokenIds) {
    const beforeGroup = beforeMap.get(tokenId) ?? [];
    const afterGroup = afterMap.get(tokenId) ?? [];
    const groupLength = Math.max(beforeGroup.length, afterGroup.length);

    for (let index = 0; index < groupLength; index += 1) {
      const beforeToken = beforeGroup[index];
      const afterToken = afterGroup[index];
      const token = beforeToken ?? afterToken;
      if (!token) continue;
      const bindingLabel = token.bindingPath
        ? `${token.category ?? "other"}:${token.bindingPath}`
        : `${token.category ?? "other"}:${token.name}`;
      const occurrence = index === 0 ? "" : `#${index + 1}`;
      const path = `tokens[${JSON.stringify(`${bindingLabel}${occurrence}`)}]`;
      const comparable = (value: TokenBinding) => Object.fromEntries(
        Object.entries(value).filter(([key]) => !["sourceId", "collectionId"].includes(key)),
      );

      if (!beforeToken || !afterToken) {
        output.push({
          frameId,
          sourceFileId,
          sourceNodeId,
          path,
          before: beforeToken ? comparable(beforeToken) : undefined,
          after: afterToken ? comparable(afterToken) : undefined,
          category: "token",
        });
        continue;
      }

      compareValue(
        comparable(beforeToken),
        comparable(afterToken),
        path,
        frameId,
        sourceFileId,
        sourceNodeId,
        output,
      );
    }
  }
}

function compareNode(
  before: SnapshotNode,
  after: SnapshotNode,
  frameId: string,
  sourceFileId: string,
  output: SnapshotDiffChange[],
  captureCoverage: CaptureCoverageCollector,
  isFrameRoot = false,
) {
  const firstChangeIndex = output.length;
  const { tokens: beforeTokens, sourcePayload: beforeSourcePayload, ...beforeRest } = before;
  const { tokens: afterTokens, sourcePayload: afterSourcePayload, ...afterRest } = after;
  const identityFields = new Set(["sourceNodeId", "parentSourceNodeId", "sourceFrameId"]);
  const beforeComparable = Object.fromEntries(Object.entries(beforeRest).filter(([key]) =>
    !identityFields.has(key) && !(isFrameRoot && (key === "bounds" || key === "margins"))));
  const afterComparable = Object.fromEntries(Object.entries(afterRest).filter(([key]) =>
    !identityFields.has(key) && !(isFrameRoot && (key === "bounds" || key === "margins"))));
  compareValue(
    withoutFigmaStyleIds(beforeComparable),
    withoutFigmaStyleIds(afterComparable),
    "",
    frameId,
    sourceFileId,
    before.sourceNodeId,
    output,
  );
  compareTokens(beforeTokens, afterTokens, frameId, sourceFileId, before.sourceNodeId, output);
  compareSourcePayloadValue(
    withoutFigmaStyleIds(withoutRedundantSourcePayloadFields(beforeSourcePayload), "sourcePayload"),
    withoutFigmaStyleIds(withoutRedundantSourcePayloadFields(afterSourcePayload), "sourcePayload"),
    "sourcePayload",
    frameId,
    sourceFileId,
    before.sourceNodeId,
    output,
    captureCoverage,
  );
  const sourceNodeName = after.name.trim() || before.name;
  for (const change of output.slice(firstChangeIndex)) {
    change.sourceNodeName = sourceNodeName;
  }
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
  const beforeNodes = frameNodes(before);
  const afterNodes = frameNodes(after);
  const nodeMatches = matchFrameNodes(beforeNodes, afterNodes, before.sourceFrameId, after.sourceFrameId);
  const beforeNodeMap = nodeIndex(beforeNodes);
  const afterNodeMap = nodeIndex(afterNodes);

  if ("bounds" in before && "bounds" in after) {
    compareValue(
      { width: before.bounds.width, height: before.bounds.height },
      { width: after.bounds.width, height: after.bounds.height },
      "bounds",
      frameId,
      sourceFileId,
      null,
      output,
    );
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

  const afterIdForBeforeId = new Map(
    nodeMatches.pairs.map(({ before: oldNode, after: newNode }) => [oldNode.sourceNodeId, newNode.sourceNodeId]),
  );
  for (const { before: beforeNode, after: afterNode } of nodeMatches.pairs) {
    const isFrameRoot = beforeNode.sourceNodeId === before.sourceFrameId && afterNode.sourceNodeId === after.sourceFrameId;
    compareNode(
      beforeNode,
      afterNode,
      frameId,
      sourceFileId,
      output,
      captureCoverage,
      isFrameRoot,
    );

    const oldParentId = beforeNode.parentSourceNodeId ?? null;
    const newParentId = afterNode.parentSourceNodeId ?? null;
    const oldParentWasMatched = oldParentId === null || afterIdForBeforeId.has(oldParentId);
    if (oldParentWasMatched && (afterIdForBeforeId.get(oldParentId ?? "") ?? null) !== newParentId) {
      const oldParent = oldParentId ? beforeNodeMap.get(oldParentId) : null;
      const newParent = newParentId ? afterNodeMap.get(newParentId) : null;
      output.push({
        frameId,
        sourceFileId,
        sourceNodeId: afterNode.sourceNodeId,
        sourceNodeName: afterNode.name,
        path: "parent",
        before: oldParent ? { name: oldParent.name, type: oldParent.type } : null,
        after: newParent ? { name: newParent.name, type: newParent.type } : null,
        category: "structure",
      });
    }
  }

  const removedNodes = nodeMatches.removed;
  const addedNodes = nodeMatches.added;
  for (const node of removedNodes) {
    output.push({
      frameId,
      sourceFileId,
      sourceNodeId: node.sourceNodeId,
      sourceNodeName: node.name,
      path: "node",
      before: node,
      after: undefined,
      category: "structure",
    });
  }
  for (const node of addedNodes) {
    output.push({
      frameId,
      sourceFileId,
      sourceNodeId: node.sourceNodeId,
      sourceNodeName: node.name,
      path: "node",
      before: undefined,
      after: node,
      category: "structure",
    });
  }
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
  const legacyFileId = "0:0";
  const hasLegacyFileId = fromFileId === legacyFileId || toFileId === legacyFileId;
  const sourceNamesMatch = Boolean(from.snapshot.sourceFileName?.trim()) &&
    from.snapshot.sourceFileName === to.snapshot.sourceFileName;
  const beforeFrameIds = new Set(beforeFrames.map((frame) => frame.sourceFrameId));
  const hasSharedFrameId = afterFrames.some((frame) => beforeFrameIds.has(frame.sourceFrameId));
  const exactSourceIdentity = fromFileId === toFileId && !hasLegacyFileId;
  const inferredSourceIdentity = hasLegacyFileId && (sourceNamesMatch || hasSharedFrameId);
  const sourceIdentity: SnapshotSourceIdentity = exactSourceIdentity
    ? "exact"
    : inferredSourceIdentity ? "inferred" : "different";
  const sharedSourceFileId = exactSourceIdentity
    ? fromFileId
    : inferredSourceIdentity
      ? fromFileId === legacyFileId ? toFileId : fromFileId
      : null;
  const beforeIdentityFileId = sharedSourceFileId ?? `${fromFileId}\u0000${from.versionId}`;
  const afterIdentityFileId = sharedSourceFileId ?? `${toFileId}\u0000${to.versionId}`;
  const beforeByKey = new Map(
    beforeFrames.map((frame) => [frameIdentity(beforeIdentityFileId, frame.sourceFrameId), frame]),
  );
  const afterByKey = new Map(
    afterFrames.map((frame) => [frameIdentity(afterIdentityFileId, frame.sourceFrameId), frame]),
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
    const beforeKey = frameIdentity(beforeIdentityFileId, match.beforeFrameId);
    const afterKey = frameIdentity(afterIdentityFileId, match.afterFrameId);
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
    const sourceFileId = sharedSourceFileId ?? (before ? fromFileId : toFileId);

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
    (frame) => !afterByKey.has(frameIdentity(beforeIdentityFileId, frame.sourceFrameId)) &&
      !explicitlyMatchedBefore.has(frameIdentity(beforeIdentityFileId, frame.sourceFrameId)),
  );
  const addedFrames = afterFrames.filter(
    (frame) => !beforeByKey.has(frameIdentity(afterIdentityFileId, frame.sourceFrameId)) &&
      !explicitlyMatchedAfter.has(frameIdentity(afterIdentityFileId, frame.sourceFrameId)),
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
    sourceIdentity,
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
