import { createHash } from "node:crypto";
import { verifyRenderAssetBytes } from "./import-snapshot";
import { assetEtag, notModifiedResponse } from "./asset-caching";
import { objectStore } from "../storage/supabase-object-store";
import { canMakeAssetVariant, ensureAssetVariant, parseAssetVariantSize } from "./asset-variants";

const maxInlineSvgBytes = 2 * 1024 * 1024;
/**
 * Images redirect to a signed Storage URL. The redirect is cached for a little less than the URL
 * lives, so within that window the browser reuses the same URL and its cached image instead of
 * asking the server again and downloading the image again on every visit.
 */
const signedUrlSeconds = 60 * 60;
const redirectCacheSeconds = 55 * 60;
// Redirects carry no ETag: revalidating one would let the browser keep a URL that has expired.
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

export type AssetResponseInput = {
  objectKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
};

function safeFileName(fileName: string) {
  return fileName.replace(/[\r\n"\\]/g, "_");
}

/** Authorize at the caller, then redirect large/private assets to short-lived Storage URLs. */
export async function createAssetResponse(request: Request, asset: AssetResponseInput) {
  const searchParams = new URL(request.url).searchParams;
  const isImage = imageTypes.has(asset.contentType);
  const download = searchParams.get("download") === "1" || !isImage;
  const variantSize = !download && canMakeAssetVariant(asset.contentType) ? parseAssetVariantSize(searchParams.get("size")) : null;
  const unchanged = notModifiedResponse(request, asset.sha256);
  if (unchanged) return unchanged;

  if (variantSize) {
    try {
      const variantKey = await ensureAssetVariant(asset.objectKey, variantSize);
      const url = await objectStore.createSignedDownloadUrl(variantKey, { expiresIn: signedUrlSeconds, download: false });
      return new Response(null, {
        status: 307,
        headers: {
          Location: url,
          "Cache-Control": `private, max-age=${redirectCacheSeconds}`,
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      // Fall back to the full-size original rather than leaving a hole in the canvas.
      console.warn("[assets] Could not make a smaller copy; serving the original:", error instanceof Error ? error.message : error);
    }
  }

  const safeName = safeFileName(asset.fileName);
  const encodedName = encodeURIComponent(safeName);

  if (asset.contentType === "image/svg+xml" && !download) {
    if (asset.sizeBytes > maxInlineSvgBytes) {
      return Response.json({ error: "This SVG exceeds the safe inline preview limit." }, { status: 413 });
    }
    const stored = await objectStore.get(asset.objectKey);
    if (!stored) return Response.json({ error: "Asset not found." }, { status: 404 });
    const checksum = createHash("sha256").update(stored.bytes).digest("hex");
    if (stored.contentType !== asset.contentType || stored.bytes.byteLength !== asset.sizeBytes || checksum !== asset.sha256) {
      return Response.json({ error: "The stored asset failed its integrity check." }, { status: 500 });
    }
    verifyRenderAssetBytes(stored.bytes, asset.contentType, asset.fileName);
    return new Response(Buffer.from(stored.bytes), {
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        ETag: assetEtag(asset.sha256),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodedName}`,
        "Content-Length": String(asset.sizeBytes),
        "Content-Type": asset.contentType,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; object-src 'none'; script-src 'none'",
      },
    });
  }

  const url = await objectStore.createSignedDownloadUrl(asset.objectKey, {
    expiresIn: download ? 300 : signedUrlSeconds,
    download: download ? safeName : false,
  });
  return new Response(null, {
    status: 307,
    headers: {
      Location: url,
      // Downloads stay uncached and short-lived; inline images reuse their URL (see above).
      "Cache-Control": download ? "private, no-store" : `private, max-age=${redirectCacheSeconds}`,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
