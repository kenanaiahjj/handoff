import { normalizeFigmaCaptureScope, pageCaptureChoice, type SnapshotEnvelope } from "@asbir/snapshot-contract";
import { getCaptureSession } from "@/src/server/repositories/capture-sessions";
import { getVersion, getVersionSnapshotSize } from "@/src/server/repositories/versions";
import { getDatabase } from "@/src/server/db";
import { unmatchedFrameCandidatesBetween } from "@/src/server/services/diff";
import { z } from "zod";

/** Names of the Figma pages a version was captured from, for the plugin's choice prompt. */
function baselinePageNames(sourceMetadata: Record<string, unknown>) {
  const layout = Array.isArray(sourceMetadata.pageLayout) ? sourceMetadata.pageLayout : [];
  const names = layout.flatMap((page) =>
    page && typeof page === "object" && typeof (page as { sourcePageName?: unknown }).sourcePageName === "string"
      ? [(page as { sourcePageName: string }).sourcePageName]
      : [],
  );
  if (names.length) return [...new Set(names)];
  return typeof sourceMetadata.sourcePageName === "string" ? [sourceMetadata.sourcePageName] : [];
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "600",
};

const snapshotSummarySchema = z.object({
  source: z.literal("figma"),
  sourceFileId: z.string().trim().min(1).max(200),
  sourceFileName: z.string().trim().max(200).nullable(),
  sourceMetadata: z.object({
    captureScope: z.unknown().optional(),
  }),
  frames: z.array(z.object({
    sourceFrameId: z.string().trim().min(1).max(200),
    sourcePageId: z.string().trim().min(1).max(200).nullable().optional(),
    name: z.string().trim().min(1).max(300),
  }).strict()).max(10_000),
}).strict();

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, {
    ...init,
    headers: { ...corsHeaders, ...init.headers },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.match(/^Bearer\s+(asbir_capture_[A-Za-z0-9_-]{32,})$/)?.[1];
  if (!token) return jsonResponse({ error: "A valid capture token is required." }, { status: 401 });
  const session = (await getCaptureSession(token));
  if (!session) return jsonResponse({ error: "This capture token is invalid, expired, already used, or no longer authorized." }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 1_000_000) {
    return jsonResponse({ error: "The compact capture preview exceeds its 1 MB limit." }, { status: 413 });
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: "Send the captured snapshot as JSON." }, { status: 400 }); }
  if (typeof body !== "object" || body === null || !("snapshotSummary" in body)) {
    return jsonResponse({ error: "A compact capture summary is required." }, { status: 400 });
  }

  const parsed = snapshotSummarySchema.safeParse(body.snapshotSummary);
  if (!parsed.success) return jsonResponse({ error: "The Figma capture summary is invalid." }, { status: 400 });
  const snapshot = parsed.data;
  if (snapshot.source !== "figma") {
    return jsonResponse({ error: "This preview endpoint accepts Figma plugin snapshots." }, { status: 400 });
  }
  if (!session.handoffId) return jsonResponse({ baselineVersionId: null, candidates: [] });

  const latest = (await getDatabase()
    .prepare(
      `SELECT id FROM handoff_version
       WHERE workspace_id = ? AND handoff_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(session.workspaceId, session.handoffId)) as { id: string } | undefined;
  if (!latest) return jsonResponse({ baselineVersionId: null, candidates: [] });

  const baseline = (await getVersion({ workspaceId: session.workspaceId, versionId: latest.id }));
  if (!baseline) return jsonResponse({ error: "The previous handoff version could not be loaded." }, { status: 409 });
  const scope = normalizeFigmaCaptureScope(snapshot.sourceMetadata.captureScope);
  let mergeContext: {
    versionId: string;
    overviewUrl: string;
    overviewWidth: number | null;
    overviewHeight: number | null;
    canvasBounds: SnapshotEnvelope["canvasBounds"] | null;
    frames: Array<Pick<SnapshotEnvelope["frames"][number], "sourceFrameId" | "sourcePageId" | "bounds" | "renderBounds">>;
    pageLayout: unknown;
  } | undefined;
  if (scope === "selected" || scope === "page") {
    if (baseline.snapshot.source !== "figma" || baseline.snapshot.sourceFileId !== snapshot.sourceFileId) {
      return jsonResponse({ error: "A selected-frame or page capture can only update the same Figma file. Capture the full file to replace this handoff." }, { status: 409 });
    }
    const overviewAsset = baseline.assets.find((asset) => asset.assetKey === baseline.snapshot.overviewAssetKey);
    if (!overviewAsset) return jsonResponse({ error: "The previous canvas overview is missing. Capture the full page to replace it." }, { status: 409 });
    mergeContext = {
      versionId: baseline.id,
      overviewUrl: `/api/capture-sessions/baseline-overview?versionId=${encodeURIComponent(baseline.id)}`,
      overviewWidth: overviewAsset.width,
      overviewHeight: overviewAsset.height,
      canvasBounds: baseline.snapshot.canvasBounds ?? null,
      frames: baseline.snapshot.source === "figma"
        ? baseline.snapshot.frames.map(({ sourceFrameId, sourcePageId, bounds, renderBounds }) => ({ sourceFrameId, sourcePageId, bounds, renderBounds }))
        : [],
      pageLayout: baseline.snapshot.source === "figma" ? baseline.snapshot.sourceMetadata.pageLayout ?? [] : [],
    };
  }
  const capturedPageIds = new Set(snapshot.frames.flatMap((frame) => frame.sourcePageId ? [frame.sourcePageId] : []));
  const hasLegacyFileId = baseline.snapshot.sourceFileId === "0:0" || snapshot.sourceFileId === "0:0";
  const candidates = unmatchedFrameCandidatesBetween(
    baseline.snapshot.frames,
    snapshot.frames,
    {
      sourceFileId: baseline.snapshot.sourceFileId,
      exactSourceIdentity: baseline.snapshot.sourceFileId === snapshot.sourceFileId && !hasLegacyFileId,
    },
  );
  const replacementCandidates = scope === "selected" || scope === "page"
    ? candidates.filter((candidate) => {
        const before = baseline.snapshot.source === "figma"
          ? baseline.snapshot.frames.find((frame) => frame.sourceFrameId === candidate.beforeFrameId)
          : undefined;
        return Boolean(before?.sourcePageId && capturedPageIds.has(before.sourcePageId));
      })
    : candidates;

  const pageChoice = baseline.snapshot.source === "figma"
    ? pageCaptureChoice({ scope, baselineFrames: baseline.snapshot.frames, incomingFrames: snapshot.frames })
    : null;
  // Lets the plugin stop an add or update that would exceed the snapshot limit before uploading anything.
  const retainedFrameIds = new Set(
    baseline.snapshot.source === "figma" && (scope === "selected" || scope === "page")
      ? baseline.snapshot.frames
        .filter((frame) => !(scope === "page" && frame.sourcePageId && capturedPageIds.has(frame.sourcePageId)))
        .filter((frame) => !snapshot.frames.some((incoming) => incoming.sourceFrameId === frame.sourceFrameId))
        .map((frame) => frame.sourceFrameId)
      : [],
  );
  const baselineFrameCount = baseline.snapshot.frames.length || 1;
  const retainedBaselineBytesEstimate = retainedFrameIds.size
    ? Math.ceil((await getVersionSnapshotSize({ workspaceId: session.workspaceId, versionId: baseline.id })) * retainedFrameIds.size / baselineFrameCount)
    : 0;

  return jsonResponse({
    baselineVersionId: baseline.id,
    candidates: replacementCandidates,
    ...(mergeContext ? { mergeContext } : {}),
    ...(pageChoice ? {
      pageChoice: {
        ...pageChoice,
        baselinePageNames: baselinePageNames(baseline.snapshot.sourceMetadata),
      },
    } : {}),
    retainedBaselineBytesEstimate,
  });
}
