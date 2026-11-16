import { visibleHandoffIds } from "@/src/server/services/review-visibility";
import { createHash } from "node:crypto";
import { getDatabase } from "@/src/server/db";
import { getAssetByObjectKey } from "@/src/server/repositories/versions";
import { objectStore } from "@/src/server/storage/local-object-store";
import { assetEtag, immutableAssetCacheControl, notModifiedResponse } from "@/src/server/services/asset-caching";
import {
  getSessionForRequest,
  requireWorkspaceRole,
  WorkspaceAccessError,
  workspaceRoles,
} from "@/src/server/workspace-access";

export async function GET(
  request: Request,
  context: RouteContext<"/api/assets/[assetKey]">,
) {
  const { assetKey } = await context.params;
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });

  const asset = getAssetByObjectKey(assetKey);
  if (!asset) return Response.json({ error: "Asset not found." }, { status: 404 });

  try {
    const access = await requireWorkspaceRole(request, asset.workspaceId, [...workspaceRoles]);
    // Images are shared between versions; reviewers may load one if any version using it is visible to them.
    const visible = visibleHandoffIds(asset.workspaceId, { id: access.userId, email: access.email, role: access.role });
    if (visible) {
      const handoffIds = getDatabase()
        .prepare(
          `SELECT DISTINCT handoff_version.handoff_id AS handoffId
           FROM handoff_asset
           JOIN handoff_version ON handoff_version.id = handoff_asset.handoff_version_id
           WHERE handoff_asset.object_key = ? AND handoff_asset.workspace_id = ?`,
        )
        .all(assetKey, asset.workspaceId) as Array<{ handoffId: string }>;
      if (!handoffIds.some((row) => visible.has(row.handoffId))) {
        return Response.json({ error: "Asset not found." }, { status: 404 });
      }
    }
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const unchanged = notModifiedResponse(request, asset.sha256);
  if (unchanged) return unchanged;

  const stored = await objectStore.get(asset.objectKey);
  if (!stored) return Response.json({ error: "Asset not found." }, { status: 404 });

  const checksum = createHash("sha256").update(stored.bytes).digest("hex");
  if (
    stored.contentType !== asset.contentType ||
    stored.bytes.byteLength !== asset.sizeBytes ||
    checksum !== asset.sha256
  ) {
    return Response.json({ error: "The stored asset failed its integrity check." }, { status: 500 });
  }

  const isImage = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(asset.contentType);
  const download = new URL(request.url).searchParams.get("download") === "1";
  const safeFileName = encodeURIComponent(asset.fileName.replace(/[\r\n\"\\]/g, "_"));

  return new Response(stored.bytes, {
    headers: {
      "Cache-Control": immutableAssetCacheControl,
      ETag: assetEtag(asset.sha256),
      "Content-Disposition": `${isImage && !download ? "inline" : "attachment"}; filename*=UTF-8''${safeFileName}`,
      "Content-Length": String(asset.sizeBytes),
      "Content-Type": asset.contentType,
      "X-Content-Type-Options": "nosniff",
      ...(asset.contentType === "image/svg+xml"
        ? { "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; object-src 'none'; script-src 'none'" }
        : {}),
    },
  });
}
