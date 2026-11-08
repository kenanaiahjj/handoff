import type { SnapshotEnvelope, SnapshotPayload } from "@asbir/snapshot-contract";
import type { CaptureAssetBytes, LayerExportAssetBytes } from "./types";

const svgFallbackWarning = "Figma SVG assets were omitted because the Handoff server rejected an SVG render. PNG screen renders and structured layer data were retained.";

export function isRejectedSvgAssetResponse(status: number, message: string): boolean {
  return status === 415 && /\bsvg\b|active content|event handler|external resource/i.test(message);
}

export function makeRasterOnlyFallback(
  snapshot: SnapshotEnvelope,
  captures: { vectorRenders: CaptureAssetBytes[]; layerRenders: LayerExportAssetBytes[] },
): { snapshot: SnapshotPayload; vectorRenders: CaptureAssetBytes[]; layerRenders: LayerExportAssetBytes[]; removedAssetKeys: string[] } {
  const removedAssetKeys = snapshot.assets
    .filter((asset) => asset.contentType === "image/svg+xml")
    .map((asset) => asset.key);
  const removedKeys = new Set(removedAssetKeys);
  const { contentHash: _contentHash, ...payload } = snapshot;
  if (!removedKeys.size) {
    return {
      snapshot: payload,
      vectorRenders: captures.vectorRenders,
      layerRenders: captures.layerRenders,
      removedAssetKeys,
    };
  }

  const frames = snapshot.frames.map((frame) => {
    const { vectorAssetKey, ...frameWithoutVector } = frame;
    const nextFrame = vectorAssetKey && removedKeys.has(vectorAssetKey) ? frameWithoutVector : frame;
    return {
      ...nextFrame,
      nodes: nextFrame.nodes.map((node) => {
        const layerExportKey = node.sourcePayload.layerExportAssetKey;
        if (typeof layerExportKey !== "string" || !removedKeys.has(layerExportKey)) return node;
        const { layerExportAssetKey: _layerKey, layerExportContentType: _layerType, ...sourcePayload } = node.sourcePayload;
        return { ...node, sourcePayload };
      }),
    };
  });
  const survivingLayerRenders = captures.layerRenders.filter((asset) => !removedKeys.has(asset.key));
  const priorWarnings = Array.isArray(snapshot.sourceMetadata.captureWarnings)
    ? snapshot.sourceMetadata.captureWarnings.filter((warning): warning is string => typeof warning === "string")
    : [];

  return {
    snapshot: {
      ...payload,
      frames,
      assets: snapshot.assets.filter((asset) => !removedKeys.has(asset.key)),
      sourceMetadata: {
        ...snapshot.sourceMetadata,
        vectorSourcePreserved: false,
        vectorSourceFrameCount: 0,
        layerExportAssetCount: survivingLayerRenders.length,
        captureWarnings: [...priorWarnings, svgFallbackWarning],
      },
    },
    vectorRenders: captures.vectorRenders.filter((asset) => !removedKeys.has(asset.key)),
    layerRenders: survivingLayerRenders,
    removedAssetKeys,
  };
}
