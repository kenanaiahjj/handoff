import { objectStore } from "../storage/supabase-object-store";
import { mapWithConcurrency } from "../map-with-concurrency";
import type { SnapshotDiff } from "./diff";

/**
 * Figma re-renders a screen slightly differently from one capture to the next (anti-aliasing on a few
 * edge pixels), so an untouched screen's image hash can change. When that is a screen's only
 * difference, look at the pixels: a channel moving by more than `visibleDelta` (out of 255) on more
 * than `maxNoisePixels` pixels is a real visual change (a shadow, an image, a vector shape, which only
 * the render captures); anything less is render noise and the screen is unchanged.
 */
const visibleDelta = 24;
const maxNoisePixels = 24;
/** Bounds the work on one comparison; screens past this keep their image change as reported. */
const maxScreensChecked = 60;

type RasterImage = { width: number; height: number; channels: number; data: Uint8Array };

/** How many pixels visibly differ between two same-sized images. Null when the sizes differ. */
export function countVisiblyChangedPixels(before: RasterImage, after: RasterImage) {
  if (before.width !== after.width || before.height !== after.height || before.channels !== after.channels) return null;
  const { channels } = before;
  const colorChannels = Math.min(3, channels);
  let changed = 0;
  for (let index = 0; index < before.data.length; index += channels) {
    for (let channel = 0; channel < colorChannels; channel += 1) {
      if (Math.abs(before.data[index + channel] - after.data[index + channel]) > visibleDelta) {
        changed += 1;
        break;
      }
    }
  }
  return changed;
}

export function isRenderNoise(changedPixels: number | null) {
  return changedPixels !== null && changedPixels <= maxNoisePixels;
}

async function decode(objectKey: string): Promise<RasterImage | null> {
  const stored = await objectStore.get(objectKey);
  if (!stored) return null;
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(Buffer.from(stored.bytes), { limitInputPixels: 16384 * 16384 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: info.channels, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

type VersionAssets = {
  snapshot: { frames: Array<{ sourceFrameId: string; renderAssetKey: string }> };
  assets: Array<{ assetKey: string; objectKey: string }>;
};

function renderObjectKey(version: VersionAssets, frameId: string | null) {
  if (!frameId) return null;
  const frame = version.snapshot.frames.find((candidate) => candidate.sourceFrameId === frameId);
  return frame ? version.assets.find((asset) => asset.assetKey === frame.renderAssetKey)?.objectKey ?? null : null;
}

/** Drops image-only "changes" that are render noise, marking those screens unchanged. Mutates `diff`. */
export async function dropRenderNoise(diff: SnapshotDiff, from: VersionAssets, to: VersionAssets) {
  const imageOnly = diff.frames.filter((frame) => {
    if (frame.status !== "changed") return false;
    const frameChanges = diff.changes.filter((change) => change.frameId === frame.frameId && change.sourceFileId === frame.sourceFileId);
    return frameChanges.length > 0 && frameChanges.every((change) => change.path === "renderAsset");
  }).slice(0, maxScreensChecked);
  if (!imageOnly.length) return diff;

  const noisy = new Set<string>();
  await mapWithConcurrency(imageOnly, 3, async (frame) => {
    const beforeKey = renderObjectKey(from, frame.beforeFrameId);
    const afterKey = renderObjectKey(to, frame.afterFrameId);
    if (!beforeKey || !afterKey) return;
    try {
      const [before, after] = await Promise.all([decode(beforeKey), decode(afterKey)]);
      if (before && after && isRenderNoise(countVisiblyChangedPixels(before, after))) noisy.add(frame.frameId);
    } catch (error) {
      // Keep the reported change if the images can't be read; a false "Changed" beats a missed one.
      console.warn("[compare] Could not check render pixels for", frame.name, error);
    }
  });
  if (!noisy.size) return diff;

  diff.changes = diff.changes.filter((change) => !(change.path === "renderAsset" && noisy.has(change.frameId)));
  for (const frame of diff.frames) {
    if (noisy.has(frame.frameId) && frame.status === "changed") frame.status = "unchanged";
  }
  return diff;
}
