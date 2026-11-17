import { createHash } from "node:crypto";
import { verifyRenderAssetBytes } from "./import-snapshot";
import { assetEtag, notModifiedResponse } from "./asset-caching";
import { objectStore } from "../storage/supabase-object-store";

const maxInlineSvgBytes = 2 * 1024 * 1024;
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
  const unchanged = notModifiedResponse(request, asset.sha256);
  if (unchanged) return unchanged;

  const isImage = imageTypes.has(asset.contentType);
  const download = new URL(request.url).searchParams.get("download") === "1" || !isImage;
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
    expiresIn: 300,
    download: download ? safeName : false,
  });
  return new Response(null, {
    status: 307,
    headers: {
      Location: url,
      "Cache-Control": "private, no-store",
      ETag: assetEtag(asset.sha256),
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
