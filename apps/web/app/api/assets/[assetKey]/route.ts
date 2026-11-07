import { createHash } from "node:crypto";
import { getAssetByObjectKey } from "@/src/server/repositories/versions";
import { objectStore } from "@/src/server/storage/local-object-store";
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
    await requireWorkspaceRole(request, asset.workspaceId, [...workspaceRoles]);
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

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
      "Cache-Control": "private, no-store",
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
