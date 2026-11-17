import { visibleHandoffIds } from "@/src/server/services/review-visibility";
import { getDatabase } from "@/src/server/db";
import { getAssetByObjectKey } from "@/src/server/repositories/versions";
import { createAssetResponse } from "@/src/server/services/asset-response";
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

  const asset = (await getAssetByObjectKey(assetKey));
  if (!asset) return Response.json({ error: "Asset not found." }, { status: 404 });

  try {
    const access = await requireWorkspaceRole(request, asset.workspaceId, [...workspaceRoles]);
    // Images are shared between versions; reviewers may load one if any version using it is visible to them.
    const visible = (await visibleHandoffIds(asset.workspaceId, { id: access.userId, email: access.email, role: access.role }));
    if (visible) {
      const handoffIds = (await getDatabase()
        .prepare(
          `SELECT DISTINCT handoff_version.handoff_id AS handoffId
           FROM handoff_asset
           JOIN handoff_version ON handoff_version.id = handoff_asset.handoff_version_id
           WHERE handoff_asset.object_key = ? AND handoff_asset.workspace_id = ?`,
        )
        .all(assetKey, asset.workspaceId)) as Array<{ handoffId: string }>;
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

  return createAssetResponse(request, asset);
}
