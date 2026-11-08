import { notFound } from "next/navigation";
import type { SnapshotEnvelope, SnapshotNode, VisualOnlySnapshot } from "@asbir/snapshot-contract";
import type { ReviewDockPanels, ReviewMetadata } from "./HandoffCanvas";
import type { CanvasFrameOption } from "./FrameNavigator";
import type { VersionOption } from "./VersionCompare";
import type { CompareRouteState } from "./compare-state";
import { HandoffReview } from "./HandoffReview";
import { getVersion, type StoredVersionAsset } from "@/src/server/repositories/versions";

export type ReviewVersionSummary = VersionOption & {
  id: string;
  source: string;
  sourceRevisionId: string | null;
  capturedAt: string;
  contentHash: string;
  visualOnly: number;
  createdBy: string;
};

type StoredVersion = NonNullable<ReturnType<typeof getVersion>>;

type AssetFrameInput = {
  id: string;
  name: string;
  assetKey: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceX: number;
  sourceY: number;
  nodes: SnapshotNode[];
  exact: boolean;
  kind: "overview" | "frame";
};

function buildCanvasFrames(version: StoredVersion) {
  const visualOnly = version.visualOnly;
  const structuredSnapshot = visualOnly ? null : version.snapshot as SnapshotEnvelope;
  const snapshot = version.snapshot;
  const assetByKey = new Map<string, StoredVersionAsset>(
    version.assets.map((asset) => [asset.assetKey, asset] as const),
  );

  function assetFrame(input: AssetFrameInput): CanvasFrameOption {
    const asset = assetByKey.get(input.assetKey);
    if (!asset) notFound();
    const layerExports: NonNullable<CanvasFrameOption["layerExports"]> = {};
    for (const node of input.nodes) {
      const layerAssetKey = node.sourcePayload.layerExportAssetKey;
      if (typeof layerAssetKey !== "string") continue;
      const layerAsset = assetByKey.get(layerAssetKey);
      if (!layerAsset || (layerAsset.contentType !== "image/png" && layerAsset.contentType !== "image/svg+xml")) continue;
      layerExports[node.sourceNodeId] = {
        downloadUrl: `/api/assets/${encodeURIComponent(layerAsset.objectKey)}?download=1`,
        fileName: layerAsset.fileName,
        contentType: layerAsset.contentType,
      };
    }
    return {
      ...input,
      imageSrc: `/api/assets/${asset.objectKey}`,
      fileName: asset.fileName,
      pixelWidth: asset.width ?? input.sourceWidth,
      pixelHeight: asset.height ?? input.sourceHeight,
      layerExports,
    };
  }

  const overviewAsset = assetByKey.get(snapshot.overviewAssetKey);
  if (!overviewAsset) notFound();
  const overviewBounds = structuredSnapshot?.canvasBounds;
  const overviewExact = Boolean(
    overviewBounds &&
    overviewBounds.x.value !== null &&
    overviewBounds.y.value !== null &&
    overviewBounds.width.value !== null && overviewBounds.width.value > 0 &&
    overviewBounds.height.value !== null && overviewBounds.height.value > 0,
  );
  const overviewWidth = overviewExact ? overviewBounds!.width.value! : overviewAsset.width ?? 1280;
  const overviewHeight = overviewExact ? overviewBounds!.height.value! : overviewAsset.height ?? 900;
  const overviewFrame = assetFrame({
    id: "__overview__",
    name: "Canvas overview",
    assetKey: snapshot.overviewAssetKey,
    sourceWidth: overviewWidth,
    sourceHeight: overviewHeight,
    sourceX: overviewBounds?.x.value ?? 0,
    sourceY: overviewBounds?.y.value ?? 0,
    nodes: overviewExact && structuredSnapshot ? structuredSnapshot.frames.flatMap((frame) => frame.nodes.map((node) => ({
      ...node,
      bounds: {
        ...node.bounds,
        x: { ...node.bounds.x, value: node.bounds.x.value === null || frame.bounds.x.value === null ? null : node.bounds.x.value + frame.bounds.x.value },
        y: { ...node.bounds.y, value: node.bounds.y.value === null || frame.bounds.y.value === null ? null : node.bounds.y.value + frame.bounds.y.value },
      },
    }))) : [],
    exact: overviewExact,
    kind: "overview",
  });

  const frames: CanvasFrameOption[] = [overviewFrame];
  if (structuredSnapshot) {
    for (const frame of structuredSnapshot.frames) {
      const frameAsset = assetByKey.get(frame.renderAssetKey);
      if (!frameAsset) notFound();
      const sourceWidth = frame.bounds.width.value ?? frameAsset.width ?? 1;
      const sourceHeight = frame.bounds.height.value ?? frameAsset.height ?? 1;
      frames.push(assetFrame({
        id: frame.sourceFrameId,
        name: frame.name,
        assetKey: frame.renderAssetKey,
        sourceWidth: sourceWidth > 0 ? sourceWidth : frameAsset.width ?? 1,
        sourceHeight: sourceHeight > 0 ? sourceHeight : frameAsset.height ?? 1,
        sourceX: frame.bounds.x.value ?? 0,
        sourceY: frame.bounds.y.value ?? 0,
        nodes: frame.nodes,
        exact: true,
        kind: "frame",
      }));
    }
  } else {
    const visualSnapshot = snapshot as VisualOnlySnapshot;
    for (const frame of visualSnapshot.frames) {
      const frameAsset = assetByKey.get(frame.renderAssetKey);
      if (!frameAsset) notFound();
      const sourceWidth = frameAsset.width ?? 1280;
      const sourceHeight = frameAsset.height ?? 900;
      frames.push(assetFrame({
        id: frame.sourceFrameId,
        name: frame.name,
        assetKey: frame.renderAssetKey,
        sourceWidth,
        sourceHeight,
        sourceX: 0,
        sourceY: 0,
        nodes: [],
        exact: false,
        kind: "frame",
      }));
    }
  }

  return { frames, visualOnly };
}

export function HandoffReviewSurface({
  workspaceId,
  projectId,
  handoffId,
  projectName,
  projectHref,
  handoffName,
  versions,
  selectedVersion,
  initialCompareRouteState,
  versionHrefPrefix,
  reviewHref,
  reviewShareId,
  publishedVersionId,
  canManageIntegrations,
  canAnnotate,
  canUseLocalPreview,
  dockPanels,
}: {
  workspaceId: string;
  projectId: string;
  handoffId: string;
  projectName: string;
  projectHref: string;
  handoffName: string;
  versions: ReviewVersionSummary[];
  selectedVersion: StoredVersion;
  initialCompareRouteState?: CompareRouteState | null;
  versionHrefPrefix: string;
  reviewHref: string | null;
  reviewShareId: string | null;
  publishedVersionId: string | null;
  canManageIntegrations: boolean;
  canAnnotate: boolean;
  canUseLocalPreview: boolean;
  dockPanels?: ReviewDockPanels;
}) {
  const { frames, visualOnly } = buildCanvasFrames(selectedVersion);
  const versionOptions = versions.map(({ id, versionLabel, releaseNote, createdAt }) => ({ id, versionLabel, releaseNote, createdAt }));
  const commentsEndpoint = `/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoffId)}/versions/${encodeURIComponent(selectedVersion.id)}/comments`;
  const selectedVersionIndex = versions.findIndex((version) => version.id === selectedVersion.id);
  const publishedVersionIndex = publishedVersionId ? versions.findIndex((version) => version.id === publishedVersionId) : -1;
  const metadata: ReviewMetadata = {
    projectName,
    projectHref,
    handoffName,
    versionLabel: selectedVersion.versionLabel,
    selectedVersionId: selectedVersion.id,
    versionHrefPrefix,
    versions: versionOptions,
    capturedAt: selectedVersion.capturedAt,
    source: selectedVersion.source,
    sourceRevisionId: selectedVersion.sourceRevisionId,
    releaseNote: selectedVersion.releaseNote,
    visualOnly,
    reviewHref,
    latestPublishedEndpoint: reviewShareId ? `/api/review/${encodeURIComponent(reviewShareId)}/latest` : null,
    publishedVersionId,
    versionIsPublished: publishedVersionIndex >= 0 && selectedVersionIndex >= publishedVersionIndex,
    contentHash: selectedVersion.contentHash,
    canManageIntegrations,
    canAnnotate,
    canUseLocalPreview,
  };

  return (
    <HandoffReview
      frames={frames}
      commentsEndpoint={commentsEndpoint}
      versions={versionOptions}
      initialCompareRouteState={initialCompareRouteState ?? null}
      workspaceId={workspaceId}
      projectId={projectId}
      handoffId={handoffId}
      selectedVersionId={selectedVersion.id}
      visualOnly={visualOnly}
      metadata={metadata}
      dockPanels={dockPanels}
    />
  );
}
