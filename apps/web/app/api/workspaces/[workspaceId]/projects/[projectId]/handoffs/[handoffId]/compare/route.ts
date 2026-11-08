import { z } from "zod";
import { getHandoff } from "@/src/server/repositories/handoffs";
import {
  createConfirmedFrameReplacementMatch,
  FrameReplacementConflictError,
  getConfirmedFrameMatchesBetweenVersions,
  getVersion,
  hasConfirmedFrameReplacementMatch,
} from "@/src/server/repositories/versions";
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
  createdAt: string;
  snapshot: StoredSnapshot;
  assets: Array<{
    assetKey: string;
    objectKey: string;
    width: number | null;
    height: number | null;
  }>;
};

const frameMatchRequestSchema = z.object({
  fromVersionId: z.string().uuid(),
  toVersionId: z.string().uuid(),
  beforeFrameId: z.string().trim().min(1).max(256),
  afterFrameId: z.string().trim().min(1).max(256),
});

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

function compareVersions(workspaceId: string, handoffId: string, from: CompareVersion, to: CompareVersion) {
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

  return { diff, frames };
}

function isEarlierVersion(left: CompareVersion, right: CompareVersion) {
  return left.createdAt.localeCompare(right.createdAt) < 0 ||
    (left.createdAt === right.createdAt && left.id.localeCompare(right.id) < 0);
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
    return Response.json(compareVersions(workspaceId, handoffId, from, to));
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(request: Request, context: CompareRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = frameMatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Choose a valid pair of screens to match." }, { status: 400 });
  }

  try {
    const access = await requireWorkspaceRole(request, workspaceId, [...workspaceRoles]);
    const handoff = getHandoff({ workspaceId, projectId, handoffId });
    if (!handoff) return Response.json({ error: "Handoff not found." }, { status: 404 });

    const fromRow = getVersion({ workspaceId, versionId: parsed.data.fromVersionId });
    const toRow = getVersion({ workspaceId, versionId: parsed.data.toVersionId });
    if (!fromRow || !toRow || fromRow.handoffId !== handoffId || toRow.handoffId !== handoffId) {
      return Response.json({ error: "The selected versions were not found in this handoff." }, { status: 404 });
    }
    if (fromRow.id === toRow.id) {
      return Response.json({ error: "Choose two different versions to match screens." }, { status: 400 });
    }

    const from = fromRow as CompareVersion;
    const to = toRow as CompareVersion;
    const currentComparison = compareVersions(workspaceId, handoffId, from, to);
    const pairIsUnmatchedCandidate = currentComparison.diff.unmatchedFrameCandidates.some((candidate) =>
      candidate.beforeFrameId === parsed.data.beforeFrameId &&
      candidate.afterCandidates.some((frame) => frame.frameId === parsed.data.afterFrameId),
    );

    const baselineIsFrom = isEarlierVersion(from, to);
    const replacement = {
      workspaceId,
      handoffId,
      baselineVersionId: baselineIsFrom ? from.id : to.id,
      newVersionId: baselineIsFrom ? to.id : from.id,
      beforeFrameId: baselineIsFrom ? parsed.data.beforeFrameId : parsed.data.afterFrameId,
      afterFrameId: baselineIsFrom ? parsed.data.afterFrameId : parsed.data.beforeFrameId,
    };
    const alreadyConfirmed = hasConfirmedFrameReplacementMatch(replacement);
    if (!pairIsUnmatchedCandidate && !alreadyConfirmed) {
      return Response.json({ error: "That screen pair is no longer an unmatched candidate. Reload the comparison and choose an available match." }, { status: 409 });
    }

    if (!alreadyConfirmed) {
      createConfirmedFrameReplacementMatch({ ...replacement, confirmedByUserId: access.userId });
    }

    return Response.json(compareVersions(workspaceId, handoffId, from, to));
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof FrameReplacementConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
