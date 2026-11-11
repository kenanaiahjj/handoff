import type {
  SnapshotEnvelope,
  SnapshotFrame,
  SnapshotNode,
  VisualOnlySnapshot,
} from "@asbir/snapshot-contract";
import { formatFigmaCaptureScope, normalizeFigmaCaptureScope } from "@asbir/snapshot-contract";

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
  status: "added" | "removed" | "changed" | "unchanged" | "only-in-before-capture" | "only-in-after-capture";
};

export type FrameMatch = {
  beforeFrameId: string;
  afterFrameId: string;
};

export type NodeMatch = {
  beforeFrameId: string;
  afterFrameId: string;
  beforeNodeId: string;
  afterNodeId: string;
};

export type SnapshotSourceIdentity = "exact" | "inferred" | "different";

export type CaptureScopeComparison =
  | { status: "different"; before: string; after: string }
  | { status: "unrecorded"; before: string | null; after: string | null };

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
  captureScopeComparison: CaptureScopeComparison | null;
  frames: FrameDiff[];
  changes: SnapshotDiffChange[];
  captureCoverage: CaptureCoverageDifference[];
  unmatchedFrameCandidates: Array<{
    sourceFileId: string;
    beforeFrameId: string;
    beforeName: string;
    afterCandidates: Array<{ frameId: string; name: string; score: number }>;
    totalCandidates: number;
    candidatesTruncated: boolean;
  }>;
  unmatchedNodeCandidates: Array<{
    sourceFileId: string;
    frameId: string;
    beforeFrameId: string;
    afterFrameId: string;
    beforeNodeId: string;
    beforeName: string;
    afterCandidates: NodeCandidate[];
    totalCandidates: number;
    candidatesTruncated: boolean;
  }>;
};

const maxUnmatchedNodeSuggestions = 10;
const maxUnmatchedFrameSuggestions = 10;

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
  compareSourceNodeIds: boolean,
  explicitMatches: NodeMatch[],
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

  if (compareSourceNodeIds) {
    for (const before of beforeNodes) {
      const after = afterById.get(before.sourceNodeId);
      if (after) pair(before, after);
    }
  }
  const beforeRoot = beforeById.get(beforeFrameId);
  const afterRoot = afterById.get(afterFrameId);
  if (beforeRoot && afterRoot) pair(beforeRoot, afterRoot);

  for (const match of explicitMatches) {
    const before = beforeById.get(match.beforeNodeId);
    const after = afterById.get(match.afterNodeId);
    if (before && after) pair(before, after);
  }

  function matchByMatchedParents() {
    for (let index = 0; index < pairs.length; index += 1) {
      const parentPair = pairs[index];
      const oldChildren = beforeChildren.get(parentPair.before.sourceNodeId) ?? [];
      const newChildren = afterChildren.get(parentPair.after.sourceNodeId) ?? [];
      const oldChildrenByKey = new Map<string, SnapshotNode[]>();
      const newChildrenByKey = new Map<string, SnapshotNode[]>();

      for (const child of oldChildren) {
        if (matchedBeforeIds.has(child.sourceNodeId)) continue;
        const key = nodeMatchKey(child);
        const candidates = oldChildrenByKey.get(key) ?? [];
        candidates.push(child);
        oldChildrenByKey.set(key, candidates);
      }
      for (const child of newChildren) {
        if (matchedAfterIds.has(child.sourceNodeId)) continue;
        const key = nodeMatchKey(child);
        const candidates = newChildrenByKey.get(key) ?? [];
        candidates.push(child);
        newChildrenByKey.set(key, candidates);
      }

      for (const [key, oldCandidates] of oldChildrenByKey) {
        const newCandidates = newChildrenByKey.get(key);
        if (oldCandidates.length === 1 && newCandidates?.length === 1) {
          pair(oldCandidates[0], newCandidates[0]);
        }
      }
    }
  }

  // Prefer exact node IDs, then match only unique type/name siblings beneath a matched parent.
  matchByMatchedParents();

  // Reparented layers can still be matched by type and name when that key is unique
  // across the remaining nodes. Duplicate labels remain candidates for review.
  const oldNodesByKey = new Map<string, SnapshotNode[]>();
  const newNodesByKey = new Map<string, SnapshotNode[]>();
  for (const before of beforeNodes) {
    if (matchedBeforeIds.has(before.sourceNodeId)) continue;
    const key = nodeMatchKey(before);
    const candidates = oldNodesByKey.get(key) ?? [];
    candidates.push(before);
    oldNodesByKey.set(key, candidates);
  }
  for (const after of afterNodes) {
    if (matchedAfterIds.has(after.sourceNodeId)) continue;
    const key = nodeMatchKey(after);
    const candidates = newNodesByKey.get(key) ?? [];
    candidates.push(after);
    newNodesByKey.set(key, candidates);
  }
  for (const [key, oldCandidates] of oldNodesByKey) {
    const newCandidates = newNodesByKey.get(key);
    if (oldCandidates.length === 1 && newCandidates?.length === 1) {
      pair(oldCandidates[0], newCandidates[0]);
    }
  }
  matchByMatchedParents();

  return {
    pairs,
    removed: beforeNodes.filter((node) => !matchedBeforeIds.has(node.sourceNodeId)),
    added: afterNodes.filter((node) => !matchedAfterIds.has(node.sourceNodeId)),
  };
}

type NodeCandidateIdentity = Pick<NodeCandidate, "sourceNodeId" | "name" | "type">;
type NodeCandidateIndex = Map<string, {
  byId: NodeCandidateIdentity[];
  byName: Map<string, NodeCandidateIdentity[]>;
}>;

function indexNodeCandidates(added: SnapshotNode[]): NodeCandidateIndex {
  const index: NodeCandidateIndex = new Map();
  for (const node of added) {
    const candidate = { sourceNodeId: node.sourceNodeId, name: node.name, type: node.type };
    let bucket = index.get(node.type);
    if (!bucket) {
      bucket = { byId: [], byName: new Map() };
      index.set(node.type, bucket);
    }
    bucket.byId.push(candidate);
    const sameName = bucket.byName.get(node.name) ?? [];
    sameName.push(candidate);
    bucket.byName.set(node.name, sameName);
  }

  for (const bucket of index.values()) {
    bucket.byId.sort((left, right) => left.sourceNodeId.localeCompare(right.sourceNodeId));
    for (const sameName of bucket.byName.values()) {
      sameName.sort((left, right) => left.sourceNodeId.localeCompare(right.sourceNodeId));
    }
  }
  return index;
}

function nodeCandidates(removed: SnapshotNode, index: NodeCandidateIndex) {
  const bucket = index.get(removed.type);
  if (!bucket) return null;

  const exactNameCandidates = bucket.byName.get(removed.name) ?? [];
  const afterCandidates: NodeCandidate[] = exactNameCandidates
    .slice(0, maxUnmatchedNodeSuggestions)
    .map((candidate) => ({ ...candidate, score: 1 }));

  for (const candidate of bucket.byId) {
    if (afterCandidates.length >= maxUnmatchedNodeSuggestions) break;
    if (candidate.name === removed.name) continue;
    afterCandidates.push({ ...candidate, score: 0.5 });
  }

  return {
    afterCandidates,
    totalCandidates: bucket.byId.length,
    candidatesTruncated: bucket.byId.length > afterCandidates.length,
  };
}

function indexFrameCandidates(added: Array<Pick<SnapshotFrame, "sourceFrameId" | "name">>) {
  const candidatesByName = new Map<string, Array<{ frameId: string; name: string; score: number }>>();
  for (const frame of added) {
    const candidates = candidatesByName.get(frame.name) ?? [];
    candidates.push({ frameId: frame.sourceFrameId, name: frame.name, score: 1 });
    candidatesByName.set(frame.name, candidates);
  }
  for (const candidates of candidatesByName.values()) {
    candidates.sort((left, right) => left.frameId.localeCompare(right.frameId));
  }
  return candidatesByName;
}

function frameCandidates(
  removed: Pick<SnapshotFrame, "name">,
  candidatesByName: Map<string, Array<{ frameId: string; name: string; score: number }>>,
) {
  const candidates = candidatesByName.get(removed.name) ?? [];
  return {
    afterCandidates: candidates.slice(0, maxUnmatchedFrameSuggestions),
    totalCandidates: candidates.length,
    candidatesTruncated: candidates.length > maxUnmatchedFrameSuggestions,
  };
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
  compareSourceIds: boolean,
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

      if (!beforeToken || !afterToken) {
        const comparable = (value: TokenBinding) => compareSourceIds
          ? value
          : Object.fromEntries(
              Object.entries(value).filter(([key]) => key !== "sourceId" && key !== "collectionId"),
            );
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

      const fields = ["sourceId", "collectionId", "category", "name", "collectionName", "mode", "value"] as const;
      for (const field of fields) {
        if (!compareSourceIds && (field === "sourceId" || field === "collectionId")) continue;
        const beforeValue = beforeToken[field];
        const afterValue = afterToken[field];
        if (equalValue(beforeValue, afterValue)) continue;
        output.push({
          frameId,
          sourceFileId,
          sourceNodeId,
          path: `${path}.${field}`,
          before: beforeValue,
          after: afterValue,
          category: "token",
        });
      }
    }
  }
}

function compareNode(
  before: SnapshotNode,
  after: SnapshotNode,
  frameId: string,
  sourceFileId: string,
  compareTokenSourceIds: boolean,
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
  compareTokens(beforeTokens, afterTokens, frameId, sourceFileId, before.sourceNodeId, compareTokenSourceIds, output);
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
  nodeMatches: NodeMatch[],
) {
  const compareTokenSourceIds = beforeSnapshot.sourceFileId === afterSnapshot.sourceFileId && beforeSnapshot.sourceFileId !== "0:0";
  const beforeNodes = frameNodes(before);
  const afterNodes = frameNodes(after);
  const frameNodeMatches = matchFrameNodes(
    beforeNodes,
    afterNodes,
    before.sourceFrameId,
    after.sourceFrameId,
    compareTokenSourceIds,
    nodeMatches.filter((match) =>
      match.beforeFrameId === before.sourceFrameId && match.afterFrameId === after.sourceFrameId,
    ),
  );
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
  const renderChanged = beforeRender.sha256 !== null && afterRender.sha256 !== null
    ? beforeRender.sha256 !== afterRender.sha256
    : !equalValue(beforeRender, afterRender);
  if (renderChanged) {
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
    frameNodeMatches.pairs.map(({ before: oldNode, after: newNode }) => [oldNode.sourceNodeId, newNode.sourceNodeId]),
  );
  for (const { before: beforeNode, after: afterNode } of frameNodeMatches.pairs) {
    const isFrameRoot = beforeNode.sourceNodeId === before.sourceFrameId && afterNode.sourceNodeId === after.sourceFrameId;
    compareNode(
      beforeNode,
      afterNode,
      frameId,
      sourceFileId,
      compareTokenSourceIds,
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

  const removedNodes = frameNodeMatches.removed;
  const addedNodes = frameNodeMatches.added;
    const removedKeys = new Set(removedNodes.map(nodeMatchKey));
    const ambiguousUnmatchedKeys = new Set(
      !compareTokenSourceIds
        ? addedNodes.map(nodeMatchKey).filter((key) => removedKeys.has(key))
        : [],
    );

    // Regenerated IDs cannot confirm whether same-name layers were replaced or added/removed.
    // Keep those layers as MCP match candidates instead of inflating confirmed change totals.
  for (const node of removedNodes) {
      if (ambiguousUnmatchedKeys.has(nodeMatchKey(node))) continue;
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
      if (ambiguousUnmatchedKeys.has(nodeMatchKey(node))) continue;
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
  const candidateIndex = indexNodeCandidates(addedNodes);
  for (const removedNode of removedNodes) {
    const candidates = nodeCandidates(removedNode, candidateIndex);
    if (candidates) {
      unmatchedNodeCandidates.push({
        sourceFileId,
        frameId,
        beforeFrameId: before.sourceFrameId,
        afterFrameId: after.sourceFrameId,
        beforeNodeId: removedNode.sourceNodeId,
        beforeName: removedNode.name,
        ...candidates,
      });
    }
  }
}

function snapshotPageId(snapshot: VersionSnapshot) {
  if (isStructuredSnapshot(snapshot)) {
    const metadataPageId = snapshot.sourceMetadata.sourcePageId;
    if (typeof metadataPageId === "string" && metadataPageId.trim()) return metadataPageId;
  }
  const pageIds = new Set(snapshot.frames.flatMap((frame) =>
    "sourcePageId" in frame && typeof frame.sourcePageId === "string" ? [frame.sourcePageId] : [],
  ));
  return pageIds.size === 1 ? [...pageIds][0] : null;
}

function canInferFrameMembershipChanges(
  from: DiffInput,
  to: DiffInput,
  sourceIdentity: SnapshotSourceIdentity,
  captureScopeComparison: CaptureScopeComparison | null,
) {
  if (sourceIdentity !== "exact" || from.snapshot.source !== to.snapshot.source) return false;
  if (from.snapshot.source !== "figma") return true;
  if (captureScopeComparison) return false;

  const beforeScope = isStructuredSnapshot(from.snapshot)
    ? normalizeFigmaCaptureScope(from.snapshot.sourceMetadata.captureScope)
    : null;
  const afterScope = isStructuredSnapshot(to.snapshot)
    ? normalizeFigmaCaptureScope(to.snapshot.sourceMetadata.captureScope)
    : null;
  if (beforeScope !== afterScope) return false;
  if (beforeScope === "file") return true;
  if (beforeScope !== "page") return false;

  const beforePageId = snapshotPageId(from.snapshot);
  return Boolean(beforePageId && beforePageId === snapshotPageId(to.snapshot));
}

export function diffSnapshots(
  from: DiffInput,
  to: DiffInput,
  options: { frameMatches?: FrameMatch[]; nodeMatches?: NodeMatch[] } = {},
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
  let captureScopeComparison: CaptureScopeComparison | null = null;
  if (from.snapshot.source === "figma" && to.snapshot.source === "figma") {
    const beforeScope = isStructuredSnapshot(from.snapshot)
      ? formatFigmaCaptureScope(from.snapshot.sourceMetadata.captureScope)
      : null;
    const afterScope = isStructuredSnapshot(to.snapshot)
      ? formatFigmaCaptureScope(to.snapshot.sourceMetadata.captureScope)
      : null;
    captureScopeComparison = !beforeScope || !afterScope
      ? { status: "unrecorded", before: beforeScope, after: afterScope }
      : beforeScope === afterScope
        ? null
        : { status: "different", before: beforeScope, after: afterScope };
  }
  const canInferFrameMembership = canInferFrameMembershipChanges(from, to, sourceIdentity, captureScopeComparison);
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
      options.nodeMatches ?? [],
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
        const status = before
          ? canInferFrameMembership ? "removed" : "only-in-before-capture"
          : canInferFrameMembership ? "added" : "only-in-after-capture";
      frameDiffs.push({
        frameId: frame.sourceFrameId,
        beforeFrameId: before?.sourceFrameId ?? null,
        afterFrameId: after?.sourceFrameId ?? null,
        sourceFileId,
        name: frame.name,
          status,
      });
        if (status === "added" || status === "removed") {
          changes.push({
            frameId: frame.sourceFrameId,
            sourceFileId,
            sourceNodeId: null,
            path: "frame",
            before: before ? { name: before.name } : undefined,
            after: after ? { name: after.name } : undefined,
            category: "structure",
          });
        }
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
      options.nodeMatches ?? [],
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
  const addedFrameCandidatesByName = indexFrameCandidates(addedFrames);
  const unmatchedFrameCandidates = removedFrames.flatMap((frame) => {
    const candidates = frameCandidates(frame, addedFrameCandidatesByName);
    return candidates.totalCandidates > 0
      ? [
          {
            sourceFileId: fromFileId,
            beforeFrameId: frame.sourceFrameId,
            beforeName: frame.name,
            ...candidates,
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
    captureScopeComparison,
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

export function searchUnmatchedNodeCandidates(
  diff: SnapshotDiff,
  input: {
    frameId: string;
    sourceFileId: string;
    beforeFrameId: string;
    beforeNodeId: string;
    query: string;
    limit?: number;
  },
) {
  const unmatchedLayer = diff.unmatchedNodeCandidates.find((candidate) =>
    candidate.frameId === input.frameId &&
    candidate.sourceFileId === input.sourceFileId &&
    candidate.beforeFrameId === input.beforeFrameId &&
    candidate.beforeNodeId === input.beforeNodeId,
  );
  if (!unmatchedLayer) return { candidates: [], totalCandidates: 0, candidatesTruncated: false };

  const removedLayer = diff.changes.find((change) =>
    change.frameId === input.frameId &&
    change.sourceFileId === input.sourceFileId &&
    change.path === "node" &&
    isRecord(change.before) &&
    change.before.sourceNodeId === input.beforeNodeId,
  )?.before;
  if (!isRecord(removedLayer) || typeof removedLayer.type !== "string") {
    return { candidates: [], totalCandidates: 0, candidatesTruncated: false };
  }

  const query = input.query.trim().toLocaleLowerCase();
  if (!query) return { candidates: [], totalCandidates: 0, candidatesTruncated: false };

  const candidates = diff.changes.flatMap((change) => {
    if (
      change.frameId !== input.frameId ||
      change.sourceFileId !== input.sourceFileId ||
      change.path !== "node" ||
      !isRecord(change.after) ||
      change.after.type !== removedLayer.type ||
      typeof change.after.sourceNodeId !== "string" ||
      typeof change.after.name !== "string"
    ) return [];

    const name = change.after.name;
    const sourceNodeId = change.after.sourceNodeId;
    if (!name.toLocaleLowerCase().includes(query) && !sourceNodeId.toLocaleLowerCase().includes(query)) return [];

    return [{
      sourceNodeId,
      name,
      type: removedLayer.type,
      score: name === removedLayer.name ? 1 : 0.5,
    }];
  }).sort((left, right) =>
    right.score - left.score || left.name.localeCompare(right.name) || left.sourceNodeId.localeCompare(right.sourceNodeId),
  );
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 50)));

  return {
    candidates: candidates.slice(0, limit),
    totalCandidates: candidates.length,
    candidatesTruncated: candidates.length > limit,
  };
}

export function createUnmatchedFramePairValidator(
  diff: Pick<SnapshotDiff, "frames" | "unmatchedFrameCandidates">,
  candidates = diff.unmatchedFrameCandidates,
) {
  const beforeNames = new Map(candidates.map((candidate) => [candidate.beforeFrameId, candidate.beforeName] as const));
  const unmatchedAfterNames = new Map(
    diff.frames.flatMap((frame) => frame.beforeFrameId === null && frame.afterFrameId
      ? [[frame.afterFrameId, frame.name] as const]
      : []),
  );

  return (beforeFrameId: string, afterFrameId: string) => {
    const beforeName = beforeNames.get(beforeFrameId);
    return beforeName !== undefined && unmatchedAfterNames.get(afterFrameId) === beforeName;
  };
}

export function isStructuredSnapshot(snapshot: VersionSnapshot): snapshot is SnapshotEnvelope {
  return !isVisualOnly(snapshot);
}
