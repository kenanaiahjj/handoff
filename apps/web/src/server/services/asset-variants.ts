import { createHash } from "node:crypto";
import { objectStore } from "../storage/supabase-object-store";

/**
 * Smaller WebP copies of a raster screen render, for drawing the canvas below full resolution.
 * They're made on first request from the stored original and kept in Storage under a key derived
 * from the original's key and the size, so every later request reuses them. The original is never
 * changed: full-size display, downloads and exports keep serving the captured PNG.
 */
export const assetVariantSizes = { half: 0.5, quarter: 0.25 } as const;
export type AssetVariantSize = keyof typeof assetVariantSizes;

const rasterTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
/** Variants are small; one is roughly half or a quarter of the original's width. */
const webpQuality = 86;

export function parseAssetVariantSize(value: string | null): AssetVariantSize | null {
  return value === "half" || value === "quarter" ? value : null;
}

export function canMakeAssetVariant(contentType: string) {
  return rasterTypes.has(contentType);
}

/** A Storage key (48 lowercase hex characters, like the originals) for one size of one asset. */
export function assetVariantKey(objectKey: string, size: AssetVariantSize) {
  return createHash("sha256").update(`variant:v1:${size}:${objectKey}`).digest("hex").slice(0, 48);
}

/** Keys this server instance has already made or found, so it doesn't look them up again. */
const knownVariants = new Set<string>();
/** Variants being made right now, so concurrent requests for the same one share the work. */
const pendingVariants = new Map<string, Promise<void>>();

async function makeVariant(objectKey: string, variantKey: string, size: AssetVariantSize) {
  const existing = await objectStore.get(variantKey);
  if (existing) return;
  const original = await objectStore.get(objectKey);
  if (!original) throw new Error("The original image is missing.");
  const { default: sharp } = await import("sharp");
  const image = sharp(Buffer.from(original.bytes), { limitInputPixels: 16384 * 16384 });
  const metadata = await image.metadata();
  if (!metadata.width) throw new Error("The original image has no width.");
  const width = Math.max(1, Math.round(metadata.width * assetVariantSizes[size]));
  const bytes = await image.resize({ width, kernel: "lanczos3" }).webp({ quality: webpQuality, effort: 4 }).toBuffer();
  try {
    await objectStore.put(variantKey, new Uint8Array(bytes), "image/webp");
  } catch (error) {
    // Another instance stored it first; that copy is just as good.
    if (!(await objectStore.get(variantKey))) throw error;
  }
}

/** Makes sure the variant exists in Storage and returns its key. Throws if it can't be made. */
export async function ensureAssetVariant(objectKey: string, size: AssetVariantSize) {
  const variantKey = assetVariantKey(objectKey, size);
  if (knownVariants.has(variantKey)) return variantKey;
  let pending = pendingVariants.get(variantKey);
  if (!pending) {
    pending = makeVariant(objectKey, variantKey, size).finally(() => pendingVariants.delete(variantKey));
    pendingVariants.set(variantKey, pending);
  }
  await pending;
  knownVariants.add(variantKey);
  return variantKey;
}
