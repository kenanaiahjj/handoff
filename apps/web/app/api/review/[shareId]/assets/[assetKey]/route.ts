import { createHash } from "node:crypto";
import { getAssetByObjectKey } from "@/src/server/repositories/versions";
import { objectStore } from "@/src/server/storage/local-object-store";
import { getVisiblePublishedReviewVersion, resolvePublishedReviewAccess } from "@/src/server/services/handoff-review-access";

type ReviewAssetRoute = { params: Promise<{ shareId: string; assetKey: string }> };

export async function GET(request: Request, context: ReviewAssetRoute) {
  const { shareId, assetKey } = await context.params;
  const access = await resolvePublishedReviewAccess(shareId, request.headers);
  if (!access) return Response.json({ error: "Published handoff not found." }, { status: 404 });
  if (!access.decision.allowed) {
    return Response.json({ error: "This handoff is not available to you." }, { status: access.session ? 404 : 401 });
  }

  const asset = getAssetByObjectKey(assetKey);
  if (!asset || asset.workspaceId !== access.handoff.workspaceId) {
    return Response.json({ error: "Asset not found." }, { status: 404 });
  }
  const version = getVisiblePublishedReviewVersion(access.handoff, asset.versionId);
  if (!version || !version.assets.some((candidate) => candidate.objectKey === asset.objectKey)) {
    return Response.json({ error: "Asset not found." }, { status: 404 });
  }

  const stored = await objectStore.get(asset.objectKey);
  if (!stored) return Response.json({ error: "Asset not found." }, { status: 404 });
  const checksum = createHash("sha256").update(stored.bytes).digest("hex");
  if (stored.contentType !== asset.contentType || stored.bytes.byteLength !== asset.sizeBytes || checksum !== asset.sha256) {
    return Response.json({ error: "The stored asset failed its integrity check." }, { status: 500 });
  }

  const isImage = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(asset.contentType);
  const download = new URL(request.url).searchParams.get("download") === "1";
  const safeFileName = encodeURIComponent(asset.fileName.replace(/[\r\n"\\]/g, "_"));
  return new Response(stored.bytes, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${isImage && !download ? "inline" : "attachment"}; filename*=UTF-8''${safeFileName}`,
      "Content-Length": String(asset.sizeBytes),
      "Content-Type": asset.contentType,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...(asset.contentType === "image/svg+xml"
        ? { "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; object-src 'none'; script-src 'none'" }
        : {}),
    },
  });
}
