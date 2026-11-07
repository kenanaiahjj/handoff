import { getHandoff } from "@/src/server/repositories/handoffs";
import { getConfirmedFrameMatchesBetweenVersions, getVersion } from "@/src/server/repositories/versions";
import type { StoredSnapshot } from "@/src/server/repositories/versions";
import { diffSnapshots, isStructuredSnapshot } from "@/src/server/services/diff";
import {
  requireWorkspaceRole,
  WorkspaceAccessError,
  workspaceRoles,
} from "@/src/server/workspace-access";

type CompareRoute = {
  params: Promise<{ workspaceId: string; projectId: string; handoffId: string }>;
};

type CompareVersion = {
  id: string;
  handoffId: string;
  snapshot: StoredSnapshot;
  assets: Array<{
    assetKey: string;
    objectKey: string;
    width: number | null;
    height: number | null;
  }>;
};

function framePreview(
  version: CompareVersion,
  frameId: string,
) {
  const frame = version.snapshot.frames.find((candidate) => candidate.sourceFrameId === frameId);
  if (!frame) return null;
  const asset = version.assets.find((candidate) => candidate.assetKey === frame.renderAssetKey);
  if (!asset) return null;
  const structuredFrame = isStructuredSnapshot(version.snapshot)
    ? version.snapshot.frames.find((candidate) => candidate.sourceFrameId === frameId) ?? null
    : null;
  const sourceWidth = structuredFrame?.bounds.width.value ?? null;
  const sourceHeight = structuredFrame?.bounds.height.value ?? null;
  const hasSourceDimensions = sourceWidth !== null && sourceHeight !== null;

  return {
    name: frame.name,
    imageUrl: `/api/assets/${asset.objectKey}`,
    width: asset.width,
    height: asset.height,
    sourceWidth: sourceWidth ?? asset.width ?? 1280,
    sourceHeight: sourceHeight ?? asset.height ?? 900,
    dimensionsSource: hasSourceDimensions ? "design" as const : "image" as const,
  };
}

export async function GET(request: Request, context: CompareRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;
  const url = new URL(request.url);
  const fromVersionId = url.searchParams.get("from");
  const toVersionId = url.searchParams.get("to");

  if (!fromVersionId || !toVersionId) {
    return Response.json({ error: "Choose two versions to compare." }, { status: 400 });
  }

  try {
    await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const handoff = getHandoff({ workspaceId, projectId, handoffId });
    if (!handoff) return Response.json({ error: "Handoff not found." }, { status: 404 });
    const fromRow = getVersion({ workspaceId, versionId: fromVersionId });
    const toRow = getVersion({ workspaceId, versionId: toVersionId });

    if (!fromRow || !toRow || fromRow.handoffId !== handoffId || toRow.handoffId !== handoffId) {
      return Response.json({ error: "The selected versions were not found in this handoff." }, { status: 404 });
    }

    const from = fromRow as CompareVersion;
    const to = toRow as CompareVersion;
    const frameMatches = getConfirmedFrameMatchesBetweenVersions({ workspaceId, handoffId, from, to });

    const diff = diffSnapshots(
      { versionId: from.id, snapshot: from.snapshot },
      { versionId: to.id, snapshot: to.snapshot },
      { frameMatches },
    );

    const frames = diff.frames.map((frame) => ({
      ...frame,
      before: frame.beforeFrameId ? framePreview(from, frame.beforeFrameId) : null,
      after: frame.afterFrameId ? framePreview(to, frame.afterFrameId) : null,
    }));

    return Response.json({ diff, frames });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
