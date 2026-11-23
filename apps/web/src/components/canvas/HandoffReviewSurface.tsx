import { notFound } from "next/navigation";
import type { SnapshotEnvelope, SnapshotNode, VisualOnlySnapshot } from "@asbir/snapshot-contract";
import type { ReviewDockPanels, ReviewMetadata } from "./HandoffCanvas";
import type { ProjectTeamMember } from "@/src/server/services/project-access";
import type { CommentIdentity } from "../comments/CommentPin";
import type { CanvasFrameOption } from "./FrameNavigator";
import type { VersionOption } from "./VersionCompare";
import type { CompareRouteState } from "./compare-state";
import { formatFigmaCaptureScope, removedFrameRecords } from "@asbir/snapshot-contract";
import { HandoffReview, type PackedCanvasFrameOption } from "./HandoffReview";
import { getVersion, type StoredVersionAsset } from "@/src/server/repositories/versions";
import { packCanvasNodes, summarizeCanvasNode } from "./canvas-node-summary";
import { canvasSectionsFromMetadata } from "./canvas-sections";

export type ReviewVersionSummary = VersionOption & {
  id: string;
  source: string;
  sourceRevisionId: string | null;
  capturedAt: string;
  contentHash: string;
  visualOnly: number;
  createdBy: string;
};

type StoredVersion = NonNullable<Awaited<ReturnType<typeof getVersion>>>;

type AssetFrameInput = {
  id: string;
  name: string;
  assetKey: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceX: number;
  sourceY: number;
  nodes: SnapshotNode[];
  overlayNodes?: CanvasFrameOption["overlayNodes"];
  maskRects?: CanvasFrameOption["maskRects"];
  keepRects?: CanvasFrameOption["keepRects"];
  sections?: CanvasFrameOption["sections"];
  exact: boolean;
  kind: "overview" | "frame";
};

function buildCanvasFrames(version: StoredVersion, publicReviewShareId?: string) {
  const visualOnly = version.visualOnly;
  const structuredSnapshot = visualOnly ? null : version.snapshot as SnapshotEnvelope;
  const captureScope = formatFigmaCaptureScope(structuredSnapshot?.sourceMetadata.captureScope);
  const snapshot = version.snapshot;
  const rawPageLayout = structuredSnapshot?.sourceMetadata.pageLayout;
  const pageLayout = Array.isArray(rawPageLayout)
    ? rawPageLayout.flatMap((page) => {
        if (typeof page !== "object" || page === null || Array.isArray(page)) return [];
        const value = page as Record<string, unknown>;
        return typeof value.sourcePageId === "string" && typeof value.offsetX === "number" && typeof value.offsetY === "number"
          ? [{ sourcePageId: value.sourcePageId, sourcePageName: typeof value.sourcePageName === "string" ? value.sourcePageName : null, offsetX: value.offsetX, offsetY: value.offsetY }]
          : [];
      })
    : [];
  const pageOffsets = new Map(pageLayout.map((page) => [page.sourcePageId, { offsetX: page.offsetX, offsetY: page.offsetY }] as const));
  const pageNames = new Map(pageLayout.flatMap((page) => page.sourcePageName ? [[page.sourcePageId, page.sourcePageName] as const] : []));
  const pageIdByFrameId = new Map(structuredSnapshot?.frames.map((frame) => [frame.sourceFrameId, frame.sourcePageId] as const) ?? []);
  const assetByKey = new Map<string, StoredVersionAsset>(
    version.assets.map((asset) => [asset.assetKey, asset] as const),
  );
  const assetUrl = (objectKey: string) => publicReviewShareId
    ? `/api/review/${encodeURIComponent(publicReviewShareId)}/assets/${encodeURIComponent(objectKey)}`
    : `/api/assets/${encodeURIComponent(objectKey)}`;

  function assetFrame({ nodes, ...input }: AssetFrameInput): PackedCanvasFrameOption {
    const asset = assetByKey.get(input.assetKey);
    if (!asset) notFound();
    const layerExports: NonNullable<CanvasFrameOption["layerExports"]> = {};
    for (const node of nodes) {
      const layerAssetKey = node.sourcePayload.layerExportAssetKey;
      if (typeof layerAssetKey !== "string") continue;
      const layerAsset = assetByKey.get(layerAssetKey);
      if (!layerAsset || (layerAsset.contentType !== "image/png" && layerAsset.contentType !== "image/svg+xml")) continue;
      layerExports[node.sourceNodeId] = {
        downloadUrl: `${assetUrl(layerAsset.objectKey)}?download=1`,
        fileName: layerAsset.fileName,
        contentType: layerAsset.contentType,
      };
    }
    return {
      ...input,
      packedNodes: packCanvasNodes(nodes.map((node) => summarizeCanvasNode(node, input.id)), input.id),
      pageName: input.kind === "frame" ? pageNames.get(pageIdByFrameId.get(input.id) ?? "") : undefined,
      imageSrc: assetUrl(asset.objectKey),
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
    nodes: [],
    // Built in the browser from the screen summaries (see buildOverviewOverlayFromScreens).
    overlayNodes: [],
    // Screens removed after this overview image was rendered are cut out of it.
    maskRects: overviewExact && structuredSnapshot
      ? removedFrameRecords(structuredSnapshot.sourceMetadata).map((removed) => {
          const offset = pageOffsets.get(removed.sourcePageId ?? "");
          return {
            x: removed.x + (offset?.offsetX ?? 0) - (overviewBounds?.x.value ?? 0),
            y: removed.y + (offset?.offsetY ?? 0) - (overviewBounds?.y.value ?? 0),
            width: removed.width,
            height: removed.height,
          };
        })
      : undefined,
    // Only the version's current screens are shown from the overview image: pixels outside them
    // are stale (removed screens, or an older picture that a page merge painted over). Each screen
    // is kept to its frame edge, not its render bounds: the sharp per-screen image is cropped to the
    // frame, so content hanging outside an unclipped frame would only show as the soft overview.
    keepRects: overviewExact && structuredSnapshot
      ? structuredSnapshot.frames.flatMap((frame) => {
          const bounds = frame.bounds;
          const [x, y, width, height] = [bounds.x.value, bounds.y.value, bounds.width.value, bounds.height.value];
          if (x === null || y === null || width === null || height === null) return [];
          const offset = pageOffsets.get(frame.sourcePageId ?? "");
          return [{
            x: x + (offset?.offsetX ?? 0) - (overviewBounds?.x.value ?? 0),
            y: y + (offset?.offsetY ?? 0) - (overviewBounds?.y.value ?? 0),
            width,
            height,
          }];
        })
      : undefined,
    // Captured Figma sections, drawn under their screens with their fill and name.
    sections: overviewExact && structuredSnapshot
      ? canvasSectionsFromMetadata({
          sourceMetadata: structuredSnapshot.sourceMetadata,
          frameIds: new Set(structuredSnapshot.frames.map((frame) => frame.sourceFrameId)),
          pageOffsets,
          origin: { x: overviewBounds?.x.value ?? 0, y: overviewBounds?.y.value ?? 0 },
        })
      : undefined,
    exact: overviewExact,
    kind: "overview",
  });

  const frames: PackedCanvasFrameOption[] = [overviewFrame];
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
        sourceX: (frame.bounds.x.value ?? 0) + (pageOffsets.get(frame.sourcePageId ?? "")?.offsetX ?? 0),
        sourceY: (frame.bounds.y.value ?? 0) + (pageOffsets.get(frame.sourcePageId ?? "")?.offsetY ?? 0),
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

  return { frames, visualOnly, captureScope };
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
  publicReviewShareId,
  publishedVersionId,
  canManageIntegrations,
  canManageSharing,
  canAnnotate,
  canComment,
  commentIdentity,
  canUseLocalPreview,
  team,
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
  publicReviewShareId?: string;
  publishedVersionId: string | null;
  canManageIntegrations: boolean;
  canManageSharing: boolean;
  canAnnotate: boolean;
  canComment?: boolean;
  commentIdentity?: CommentIdentity | null;
  canUseLocalPreview: boolean;
  team?: ProjectTeamMember[] | null;
  dockPanels?: ReviewDockPanels;
}) {
  const { frames, visualOnly, captureScope } = buildCanvasFrames(selectedVersion, publicReviewShareId);
  const versionOptions = versions.map(({ id, versionLabel, releaseNote, createdAt }) => ({ id, versionLabel, releaseNote, createdAt }));
  const commentsEndpoint = publicReviewShareId
    ? `/api/review/${encodeURIComponent(publicReviewShareId)}/versions/${encodeURIComponent(selectedVersion.id)}/comments`
    : `/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoffId)}/versions/${encodeURIComponent(selectedVersion.id)}/comments`;
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
    captureScope,
    sourceRevisionId: selectedVersion.sourceRevisionId,
    releaseNote: selectedVersion.releaseNote,
    visualOnly,
    reviewHref,
    latestPublishedEndpoint: reviewShareId ? `/api/review/${encodeURIComponent(reviewShareId)}/latest` : null,
    publishedVersionId,
    versionIsPublished: publishedVersionIndex >= 0 && selectedVersionIndex >= publishedVersionIndex,
    contentHash: selectedVersion.contentHash,
    canManageIntegrations,
    canManageSharing,
    canAnnotate,
    canComment: canComment ?? canAnnotate,
    commentIdentity: commentIdentity ?? null,
    canUseLocalPreview,
    team: team ?? null,
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
      compareEndpointBase={publicReviewShareId
        ? `/api/review/${encodeURIComponent(publicReviewShareId)}/compare`
        : `/api/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/handoffs/${encodeURIComponent(handoffId)}/compare`}
    />
  );
}
