import { hashSnapshotPayload, MAX_SNAPSHOT_JSON_BYTES, normalizeFigmaCaptureScope, snapshotEnvelopeSchema, type SnapshotEnvelope } from "@asbir/snapshot-contract";
import { getCaptureSession } from "@/src/server/repositories/capture-sessions";
import { getVersion } from "@/src/server/repositories/versions";
import { getDatabase } from "@/src/server/db";
import { diffSnapshots } from "@/src/server/services/diff";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "600",
};

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
  const session = getCaptureSession(token);
  if (!session) return jsonResponse({ error: "This capture token is invalid, expired, already used, or no longer authorized." }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_SNAPSHOT_JSON_BYTES) {
    return jsonResponse({ error: "The snapshot exceeds Handoff’s 128 MiB preview limit." }, { status: 413 });
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: "Send the captured snapshot as JSON." }, { status: 400 }); }
  if (typeof body !== "object" || body === null || !("snapshot" in body)) {
    return jsonResponse({ error: "A captured snapshot is required." }, { status: 400 });
  }

  const parsed = snapshotEnvelopeSchema.safeParse(body.snapshot);
  if (!parsed.success) return jsonResponse({ error: "The Figma capture does not match the structured snapshot format." }, { status: 400 });
  const snapshot = parsed.data;
  if (snapshot.source !== "figma" || snapshot.sourceMetadata.sourceTool !== "figma") {
    return jsonResponse({ error: "This preview endpoint accepts Figma plugin snapshots." }, { status: 400 });
  }
  if (snapshot.contentHash !== await hashSnapshotPayload(snapshot)) {
    return jsonResponse({ error: "Snapshot content hash does not match its content." }, { status: 400 });
  }
  if (!session.handoffId) return jsonResponse({ baselineVersionId: null, candidates: [] });

  const latest = getDatabase()
    .prepare(
      `SELECT id FROM handoff_version
       WHERE workspace_id = ? AND handoff_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(session.workspaceId, session.handoffId) as { id: string } | undefined;
  if (!latest) return jsonResponse({ baselineVersionId: null, candidates: [] });

  const baseline = getVersion({ workspaceId: session.workspaceId, versionId: latest.id });
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
  const diff = diffSnapshots(
    { versionId: baseline.id, snapshot: baseline.snapshot },
    { versionId: "incoming-capture", snapshot },
  );

  const capturedPageIds = new Set(snapshot.frames.flatMap((frame) => frame.sourcePageId ? [frame.sourcePageId] : []));
  const replacementCandidates = scope === "selected" || scope === "page"
    ? diff.unmatchedFrameCandidates.filter((candidate) => {
        const before = baseline.snapshot.source === "figma"
          ? baseline.snapshot.frames.find((frame) => frame.sourceFrameId === candidate.beforeFrameId)
          : undefined;
        return Boolean(before?.sourcePageId && capturedPageIds.has(before.sourcePageId));
      })
    : diff.unmatchedFrameCandidates;

  return jsonResponse({
    baselineVersionId: baseline.id,
    candidates: replacementCandidates,
    ...(mergeContext ? { mergeContext } : {}),
  });
}
