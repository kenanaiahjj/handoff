import { z } from "zod";
import { getHandoff } from "@/src/server/repositories/handoffs";
import { getDatabase } from "@/src/server/db";
import { matchStateKey, readSavedComparison, saveComparison } from "@/src/server/services/comparison-cache";
import {
  createConfirmedFrameReplacementMatch,
  createConfirmedNodeReplacementMatch,
  FrameReplacementConflictError,
  getConfirmedFrameMatchesBetweenVersions,
  getConfirmedNodeMatchesBetweenVersions,
  getVersion,
  hasConfirmedFrameReplacementMatch,
  hasConfirmedNodeReplacementMatch,
  NodeReplacementConflictError,
} from "@/src/server/repositories/versions";
import type { StoredSnapshot } from "@/src/server/repositories/versions";
import {
  createUnmatchedFramePairValidator,
  diffSnapshots,
  isStructuredSnapshot,
  searchUnmatchedNodeCandidates,
} from "@/src/server/services/diff";
import {
  requireWorkspaceRole,
  WorkspaceAccessError,
  workspaceRoles,
  requireHandoffAccess,
} from "@/src/server/workspace-access";

/**
 * Large captures (250 MB of JSON) take tens of seconds to verify, merge and store. 300 s is the
 * highest limit every Vercel plan accepts; on Pro it can be raised to 800 here.
 */
export const maxDuration = 300;

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

const nodeMatchRequestSchema = z.object({
  kind: z.literal("node"),
  fromVersionId: z.string().uuid(),
  toVersionId: z.string().uuid(),
  beforeFrameId: z.string().trim().min(1).max(256),
  afterFrameId: z.string().trim().min(1).max(256),
  beforeNodeId: z.string().trim().min(1).max(256),
  afterNodeId: z.string().trim().min(1).max(256),
});

const nodeSearchRequestSchema = z.object({
  sourceFileId: z.string().trim().min(1).max(256),
  beforeFrameId: z.string().trim().min(1).max(256),
  afterFrameId: z.string().trim().min(1).max(256),
  beforeNodeId: z.string().trim().min(1).max(256),
  query: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(100).optional(),
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

async function compareVersions(workspaceId: string, handoffId: string, from: CompareVersion, to: CompareVersion) {
  const frameMatches = (await getConfirmedFrameMatchesBetweenVersions({ workspaceId, handoffId, from, to }));
  const nodeMatches = (await getConfirmedNodeMatchesBetweenVersions({ workspaceId, handoffId, from, to }));
  const diff = diffSnapshots(
    { versionId: from.id, snapshot: from.snapshot },
    { versionId: to.id, snapshot: to.snapshot },
    { frameMatches, nodeMatches },
  );
  const frames = diff.frames.map((frame) => ({
    ...frame,
    before: frame.beforeFrameId ? framePreview(from, frame.beforeFrameId) : null,
    after: frame.afterFrameId ? framePreview(to, frame.afterFrameId) : null,
  }));

  return { diff, frames };
}

async function versionsBelongToHandoff(workspaceId: string, handoffId: string, versionIds: string[]) {
  const row = (await getDatabase()
    .prepare(
      `SELECT COUNT(DISTINCT id) AS total FROM handoff_version
       WHERE workspace_id = ? AND handoff_id = ? AND id IN (?, ?)`,
    )
    .get(workspaceId, handoffId, versionIds[0], versionIds[1])) as { total: number };
  return row.total === new Set(versionIds).size;
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
  const nodeSearch = url.searchParams.get("nodeSearch");
  const parsedNodeSearch = nodeSearch === null
    ? null
    : nodeSearchRequestSchema.safeParse({
        sourceFileId: url.searchParams.get("sourceFileId"),
        beforeFrameId: url.searchParams.get("beforeFrameId"),
        afterFrameId: url.searchParams.get("afterFrameId"),
        beforeNodeId: url.searchParams.get("beforeNodeId"),
        query: nodeSearch,
        limit: url.searchParams.get("limit") ?? undefined,
      });
  if (parsedNodeSearch && !parsedNodeSearch.success) {
    return Response.json({ error: "Enter a layer name or ID and choose a valid comparison." }, { status: 400 });
  }

  try {
    await requireHandoffAccess(request, { workspaceId, handoffId });
    const handoff = (await getHandoff({ workspaceId, projectId, handoffId }));
    if (!handoff) return Response.json({ error: "Handoff not found." }, { status: 404 });

    // A saved comparison skips loading both captures and recomputing the diff. It is only used when
    // both versions belong to this handoff and the confirmed matches haven't changed since.
    const matchKey = parsedNodeSearch ? null : (await matchStateKey(handoffId));
    if (matchKey && (await versionsBelongToHandoff(workspaceId, handoffId, [fromVersionId, toVersionId]))) {
      // The cache only saves time: if it can't be read, compute the comparison as usual.
      const saved = await readSavedComparison({ fromVersionId, toVersionId, matchKey }).catch((error: unknown) => {
        console.warn("[compare] Ignoring an unreadable saved comparison:", error);
        return null;
      });
      if (saved) return new Response(saved, { headers: { "Content-Type": "application/json" } });
    }

    const fromRow = (await getVersion({ workspaceId, versionId: fromVersionId }));
    const toRow = (await getVersion({ workspaceId, versionId: toVersionId }));

    if (!fromRow || !toRow || fromRow.handoffId !== handoffId || toRow.handoffId !== handoffId) {
      return Response.json({ error: "The selected versions were not found in this handoff." }, { status: 404 });
    }

    const from = fromRow as CompareVersion;
    const to = toRow as CompareVersion;
    const comparison = (await compareVersions(workspaceId, handoffId, from, to));
    if (parsedNodeSearch?.success) {
      const { query, limit, ...candidate } = parsedNodeSearch.data;
      return Response.json(searchUnmatchedNodeCandidates(comparison.diff, {
        ...candidate,
        frameId: candidate.afterFrameId,
        query,
        limit,
      }), { headers: { "Cache-Control": "no-store" } });
    }
    const json = JSON.stringify(comparison);
    if (matchKey) {
      // Saved before responding so it persists on serverless, but a failed save never fails the comparison.
      await saveComparison({ handoffId, fromVersionId, toVersionId, matchKey, json }).catch((error: unknown) => {
        console.warn("[compare] Could not save the comparison; it will be recomputed next time:", error);
      });
    }
    return new Response(json, { headers: { "Content-Type": "application/json" } });
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
  const isNodeMatch = Boolean(body && typeof body === "object" && "kind" in body && body.kind === "node");
  const parsedNodeMatch = nodeMatchRequestSchema.safeParse(body);
  const parsedFrameMatch = frameMatchRequestSchema.safeParse(body);
  if ((isNodeMatch && !parsedNodeMatch.success) || (!isNodeMatch && !parsedFrameMatch.success)) {
    return Response.json({ error: "Choose a valid pair of screens to match." }, { status: 400 });
  }

  try {
    const access = await requireHandoffAccess(request, { workspaceId, handoffId, manage: true });
    const handoff = (await getHandoff({ workspaceId, projectId, handoffId }));
    if (!handoff) return Response.json({ error: "Handoff not found." }, { status: 404 });

    const fromVersionId = isNodeMatch && parsedNodeMatch.success
      ? parsedNodeMatch.data.fromVersionId
      : parsedFrameMatch.success ? parsedFrameMatch.data.fromVersionId : "";
    const toVersionId = isNodeMatch && parsedNodeMatch.success
      ? parsedNodeMatch.data.toVersionId
      : parsedFrameMatch.success ? parsedFrameMatch.data.toVersionId : "";
    const fromRow = (await getVersion({ workspaceId, versionId: fromVersionId }));
    const toRow = (await getVersion({ workspaceId, versionId: toVersionId }));
    if (!fromRow || !toRow || fromRow.handoffId !== handoffId || toRow.handoffId !== handoffId) {
      return Response.json({ error: "The selected versions were not found in this handoff." }, { status: 404 });
    }
    if (fromRow.id === toRow.id) {
      return Response.json({ error: "Choose two different versions to match screens." }, { status: 400 });
    }

    const from = fromRow as CompareVersion;
    const to = toRow as CompareVersion;
    const currentComparison = (await compareVersions(workspaceId, handoffId, from, to));
    const baselineIsFrom = isEarlierVersion(from, to);

    if (isNodeMatch && parsedNodeMatch.success) {
      const match = parsedNodeMatch.data;
      const unmatchedLayer = currentComparison.diff.unmatchedNodeCandidates.find((candidate) =>
        candidate.beforeFrameId === match.beforeFrameId &&
        candidate.afterFrameId === match.afterFrameId &&
        candidate.beforeNodeId === match.beforeNodeId,
      );
      const pairIsUnmatchedCandidate = unmatchedLayer
        ? searchUnmatchedNodeCandidates(currentComparison.diff, {
            frameId: unmatchedLayer.frameId,
            sourceFileId: unmatchedLayer.sourceFileId,
            beforeFrameId: match.beforeFrameId,
            beforeNodeId: match.beforeNodeId,
            query: match.afterNodeId,
            limit: 100,
          }).candidates.some((node) => node.sourceNodeId === match.afterNodeId)
        : false;
      const replacement = {
        workspaceId,
        handoffId,
        baselineVersionId: baselineIsFrom ? from.id : to.id,
        newVersionId: baselineIsFrom ? to.id : from.id,
        beforeFrameId: baselineIsFrom ? match.beforeFrameId : match.afterFrameId,
        afterFrameId: baselineIsFrom ? match.afterFrameId : match.beforeFrameId,
        beforeNodeId: baselineIsFrom ? match.beforeNodeId : match.afterNodeId,
        afterNodeId: baselineIsFrom ? match.afterNodeId : match.beforeNodeId,
      };
      const alreadyConfirmed = (await hasConfirmedNodeReplacementMatch(replacement));
      if (!pairIsUnmatchedCandidate && !alreadyConfirmed) {
        return Response.json({ error: "That layer pair is no longer an unmatched candidate. Reload the comparison and choose an available match." }, { status: 409 });
      }
      if (!alreadyConfirmed) {
        await createConfirmedNodeReplacementMatch({ ...replacement, confirmedByUserId: access.userId });
      }
      return Response.json((await compareVersions(workspaceId, handoffId, from, to)));
    }

    if (!parsedFrameMatch.success) {
      return Response.json({ error: "Choose a valid pair of screens to match." }, { status: 400 });
    }
    const match = parsedFrameMatch.data;
    const pairIsUnmatchedCandidate = createUnmatchedFramePairValidator(currentComparison.diff)(
      match.beforeFrameId,
      match.afterFrameId,
    );
    const replacement = {
      workspaceId,
      handoffId,
      baselineVersionId: baselineIsFrom ? from.id : to.id,
      newVersionId: baselineIsFrom ? to.id : from.id,
      beforeFrameId: baselineIsFrom ? match.beforeFrameId : match.afterFrameId,
      afterFrameId: baselineIsFrom ? match.afterFrameId : match.beforeFrameId,
    };
    const alreadyConfirmed = (await hasConfirmedFrameReplacementMatch(replacement));
    if (!pairIsUnmatchedCandidate && !alreadyConfirmed) {
      return Response.json({ error: "That screen pair is no longer an unmatched candidate. Reload the comparison and choose an available match." }, { status: 409 });
    }
    if (!alreadyConfirmed) {
      await createConfirmedFrameReplacementMatch({ ...replacement, confirmedByUserId: access.userId });
    }

    return Response.json((await compareVersions(workspaceId, handoffId, from, to)));
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof FrameReplacementConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof NodeReplacementConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
