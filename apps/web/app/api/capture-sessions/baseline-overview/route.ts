import { createHash } from "node:crypto";
import { getCaptureSession } from "@/src/server/repositories/capture-sessions";
import { getVersion } from "@/src/server/repositories/versions";
import { getDatabase } from "@/src/server/db";
import { objectStore } from "@/src/server/storage/local-object-store";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization",
  "Access-Control-Max-Age": "600",
};

function jsonResponse(body: unknown, status: number) {
  return Response.json(body, { status, headers: corsHeaders });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.match(/^Bearer\s+(asbir_capture_[A-Za-z0-9_-]{32,})$/)?.[1];
  if (!token) return jsonResponse({ error: "A valid capture token is required." }, 401);
  const session = getCaptureSession(token);
  if (!session?.handoffId) return jsonResponse({ error: "This capture token is invalid, expired, or no longer linked to a handoff." }, 401);

  const versionId = new URL(request.url).searchParams.get("versionId");
  if (!versionId) return jsonResponse({ error: "A baseline version is required." }, 400);
  const latest = getDatabase()
    .prepare(
      `SELECT id FROM handoff_version
       WHERE workspace_id = ? AND handoff_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(session.workspaceId, session.handoffId) as { id: string } | undefined;
  if (latest?.id !== versionId) return jsonResponse({ error: "The handoff changed during capture review. Capture again to use the latest version." }, 409);

  const version = getVersion({ workspaceId: session.workspaceId, versionId });
  if (!version || version.handoffId !== session.handoffId || version.snapshot.source !== "figma") {
    return jsonResponse({ error: "The Figma baseline overview is unavailable." }, 404);
  }
  const asset = version.assets.find((item) => item.assetKey === version.snapshot.overviewAssetKey);
  if (!asset || asset.contentType !== "image/png") return jsonResponse({ error: "The Figma baseline overview is unavailable." }, 404);

  const stored = await objectStore.get(asset.objectKey);
  if (!stored) return jsonResponse({ error: "The Figma baseline overview is missing from storage." }, 404);
  const checksum = createHash("sha256").update(stored.bytes).digest("hex");
  if (stored.contentType !== asset.contentType || stored.bytes.byteLength !== asset.sizeBytes || checksum !== asset.sha256) {
    return jsonResponse({ error: "The stored Figma baseline overview failed its integrity check." }, 500);
  }

  return new Response(stored.bytes, {
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
      "Content-Length": String(asset.sizeBytes),
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
