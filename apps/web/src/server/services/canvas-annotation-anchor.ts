import type { SnapshotEnvelope } from "@asbir/snapshot-contract";

export function canvasAnnotationAnchorError(
  snapshot: SnapshotEnvelope,
  input: { frameId: string; sourceNodeId: string | null; x: number; y: number },
): string | null {
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
    return "The annotation point is outside the canvas bounds.";
  }

  if (input.frameId === "__overview__") {
    if (input.sourceNodeId) return "A canvas point cannot be linked to a layer.";
    const overview = snapshot.assets.find((asset) => asset.key === snapshot.overviewAssetKey);
    const width = snapshot.canvasBounds?.width.value ?? overview?.width ?? null;
    const height = snapshot.canvasBounds?.height.value ?? overview?.height ?? null;
    if (width === null || height === null || input.x < 0 || input.y < 0 || input.x > width || input.y > height) {
      return "The annotation point is outside the canvas bounds.";
    }
    return null;
  }

  const frame = snapshot.frames.find((candidate) => candidate.sourceFrameId === input.frameId);
  if (!frame) return "Choose a screen in this version.";
  const width = frame.bounds.width.value;
  const height = frame.bounds.height.value;
  if (width === null || height === null || input.x < 0 || input.y < 0 || input.x > width || input.y > height) {
    return "The annotation point is outside the screen bounds.";
  }
  if (input.sourceNodeId && !frame.nodes.some((node) => node.sourceNodeId === input.sourceNodeId)) {
    return "The selected layer is not in this screen.";
  }
  return null;
}
