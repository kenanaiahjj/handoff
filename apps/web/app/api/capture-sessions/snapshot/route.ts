import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCaptureSession } from "@/src/server/repositories/capture-sessions";
import { createHandoffVersion, getVersion, HandoffVersionConflictError, type VersionAssetInput } from "@/src/server/repositories/versions";
import { getDatabase } from "@/src/server/db";
import { diffSnapshots } from "@/src/server/services/diff";
import { parseUploadForm, SnapshotImportError, verifyRenderAssetBytes } from "@/src/server/services/import-snapshot";
import { createSnapshotEnvelope, MAX_CAPTURE_ASSET_BYTES, MAX_SNAPSHOT_JSON_BYTES, normalizeFigmaCaptureScope, snapshotEnvelopeSchema, type SnapshotEnvelope } from "@asbir/snapshot-contract";
import { mergeFigmaCaptureSnapshots } from "@/src/server/services/merge-figma-capture";
import { findReusableAsset } from "@/src/server/services/reusable-assets";

const maxAssetsBytes = MAX_CAPTURE_ASSET_BYTES;
const maxSnapshotJsonBytes = MAX_SNAPSHOT_JSON_BYTES;
const supportedContentTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const frameMatchesSchema = z.array(z.object({
  beforeFrameId: z.string().trim().min(1).max(200),
  afterFrameId: z.string().trim().min(1).max(200),
}).strict()).max(5_000);

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

  let form: FormData;
  try {
    form = await parseUploadForm(
      request,
      maxAssetsBytes + maxSnapshotJsonBytes + 2 * 1024 * 1024,
    );
  } catch (error) {
    if (error instanceof SnapshotImportError) {
      return jsonResponse({ error: error.message }, { status: error.status });
    }
    return jsonResponse({ error: "Send the snapshot and render assets as multipart form data." }, { status: 400 });
  }
  if (form.getAll("snapshot").length !== 1) return jsonResponse({ error: "Send exactly one snapshot JSON field." }, { status: 400 });
  const serializedSnapshot = form.get("snapshot");
  if (typeof serializedSnapshot !== "string") return jsonResponse({ error: "Snapshot JSON is required." }, { status: 400 });
  if (Buffer.byteLength(serializedSnapshot, "utf8") > maxSnapshotJsonBytes) {
    return jsonResponse({ error: "The structured snapshot exceeds Handoff’s 128 MiB JSON limit." }, { status: 413 });
  }
  let json: unknown;
  try { json = JSON.parse(serializedSnapshot); }
  catch { return jsonResponse({ error: "Snapshot JSON is not valid." }, { status: 400 }); }
  const parsed = snapshotEnvelopeSchema.safeParse(json);
  if (!parsed.success) return jsonResponse({ error: "The Figma capture does not match the structured snapshot format.", issues: parsed.error.issues.slice(0, 30) }, { status: 400 });
  const snapshot = parsed.data;
  if (snapshot.source !== "figma" || snapshot.sourceMetadata.sourceTool !== "figma") {
    return jsonResponse({ error: "This capture endpoint accepts Figma plugin snapshots." }, { status: 400 });
  }
  const baselineFields = form.getAll("baselineVersionId");
  const matchFields = form.getAll("frameMatches");
  if (baselineFields.length > 1 || matchFields.length > 1) return jsonResponse({ error: "Send one frame replacement confirmation." }, { status: 400 });
  let baselineVersionId: string | null = null;
  let frameMatches: z.infer<typeof frameMatchesSchema> = [];
  if (baselineFields.length) {
    const rawBaseline = baselineFields[0];
    if (typeof rawBaseline !== "string" || !rawBaseline) return jsonResponse({ error: "The replacement baseline is invalid." }, { status: 400 });
    baselineVersionId = rawBaseline;
  }
  if (matchFields.length) {
    const rawMatches = matchFields[0];
    if (typeof rawMatches !== "string") return jsonResponse({ error: "The frame replacement confirmation is invalid." }, { status: 400 });
    let value: unknown;
    try { value = JSON.parse(rawMatches); }
    catch { return jsonResponse({ error: "The frame replacement confirmation is not valid JSON." }, { status: 400 }); }
    const parsedMatches = frameMatchesSchema.safeParse(value);
    if (!parsedMatches.success) return jsonResponse({ error: "The frame replacement confirmation is invalid." }, { status: 400 });
    frameMatches = parsedMatches.data;
  }
  const captureScope = normalizeFigmaCaptureScope(snapshot.sourceMetadata.captureScope);
  const isPartialCapture = captureScope === "selected" || captureScope === "page";
  const database = getDatabase();
  const latest = session.handoffId
    ? database
        .prepare(
          `SELECT id FROM handoff_version
           WHERE workspace_id = ? AND handoff_id = ?
           ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .get(session.workspaceId, session.handoffId) as { id: string } | undefined
    : undefined;
  if (baselineVersionId && (!session.handoffId || latest?.id !== baselineVersionId)) {
    return jsonResponse({ error: "The handoff changed while you reviewed this capture. Capture again to compare with the latest version." }, { status: 409 });
  }
  if (isPartialCapture && latest && !baselineVersionId) {
    return jsonResponse({ error: "The latest handoff version is required to merge a selected-frame capture. Preview the capture again." }, { status: 409 });
  }
  if (frameMatches.length && (!session.handoffId || !baselineVersionId)) {
    return jsonResponse({ error: "A previous handoff version is required to confirm frame replacements." }, { status: 400 });
  }
  const baseline = baselineVersionId
    ? getVersion({ workspaceId: session.workspaceId, versionId: baselineVersionId })
    : null;
  if (baselineVersionId && !baseline) return jsonResponse({ error: "The replacement baseline could not be loaded." }, { status: 409 });
  if (isPartialCapture && baseline) {
    if (baseline.snapshot.source !== "figma" || baseline.snapshot.sourceFileId !== snapshot.sourceFileId) {
      return jsonResponse({ error: "A selected-frame or page capture can only update the same Figma file. Capture the full file to replace this handoff." }, { status: 409 });
    }
  }

  if (frameMatches.length && baseline) {
    const candidateDiff = diffSnapshots(
      { versionId: baseline.id, snapshot: baseline.snapshot },
      { versionId: "incoming-capture", snapshot },
    );
    const capturedPageIds = new Set(snapshot.frames.flatMap((frame) => frame.sourcePageId ? [frame.sourcePageId] : []));
    const eligibleCandidates = isPartialCapture && baseline.snapshot.source === "figma"
      ? candidateDiff.unmatchedFrameCandidates.filter((candidate) => {
          const before = baseline.snapshot.source === "figma"
            ? baseline.snapshot.frames.find((frame) => frame.sourceFrameId === candidate.beforeFrameId)
            : undefined;
          return Boolean(before?.sourcePageId && capturedPageIds.has(before.sourcePageId));
        })
      : candidateDiff.unmatchedFrameCandidates;
    const allowedPairs = new Set(eligibleCandidates.flatMap((candidate) =>
      candidate.afterCandidates.map((frame) => `${candidate.beforeFrameId}\u0000${frame.frameId}`),
    ));
    const beforeIds = new Set<string>();
    const afterIds = new Set<string>();
    for (const match of frameMatches) {
      const pair = `${match.beforeFrameId}\u0000${match.afterFrameId}`;
      if (!allowedPairs.has(pair) || beforeIds.has(match.beforeFrameId) || afterIds.has(match.afterFrameId)) {
        return jsonResponse({ error: "Choose each suggested old and new frame once." }, { status: 400 });
      }
      beforeIds.add(match.beforeFrameId);
      afterIds.add(match.afterFrameId);
    }
  }

  let totalBytes = 0;
  const assets: VersionAssetInput[] = [];
  for (const asset of snapshot.assets) {
    if (form.getAll(`asset:${asset.key}`).length !== 1) return jsonResponse({ error: `Send exactly one copy of render asset "${asset.fileName}".` }, { status: 400 });
    const uploaded = form.get(`asset:${asset.key}`);
    if (!(uploaded instanceof File)) return jsonResponse({ error: `Render asset "${asset.fileName}" is missing.` }, { status: 400 });
    if (uploaded.name !== asset.fileName || uploaded.type !== asset.contentType || !supportedContentTypes.has(uploaded.type)) {
      return jsonResponse({ error: `Render asset metadata does not match for "${asset.fileName}".` }, { status: 400 });
    }
    totalBytes += uploaded.size;
    if (totalBytes > maxAssetsBytes) return jsonResponse({ error: "This capture exceeds Handoff’s 256 MiB asset limit." }, { status: 413 });
    const bytes = new Uint8Array(await uploaded.arrayBuffer());
    try {
      const dimensions = verifyRenderAssetBytes(bytes, asset.contentType, asset.fileName);
      if (dimensions && ((asset.width !== undefined && asset.width !== dimensions.width) || (asset.height !== undefined && asset.height !== dimensions.height))) {
        return jsonResponse({ error: `Render dimensions do not match for "${asset.fileName}".` }, { status: 400 });
      }
    } catch (error) {
      if (error instanceof SnapshotImportError) return jsonResponse({ error: error.message }, { status: error.status });
      throw error;
    }
    assets.push({ ...asset, bytes });
  }
  const allowedKeys = new Set(["snapshot", "baselineVersionId", "frameMatches", ...snapshot.assets.map((asset) => `asset:${asset.key}`)]);
  for (const [key] of form.entries()) {
    if (!allowedKeys.has(key)) return jsonResponse({ error: "The capture includes an unexpected form field." }, { status: 400 });
  }

  try {
    let versionSnapshot: SnapshotEnvelope = snapshot;
    let versionAssets: VersionAssetInput[] = assets;
    let reuseAssetsFromVersionId: string | undefined;

    if (isPartialCapture && baseline && baselineVersionId) {
      if (baseline.snapshot.source !== "figma") {
        return jsonResponse({ error: "A selected-frame or page capture requires a structured Figma baseline." }, { status: 409 });
      }
      const merged = mergeFigmaCaptureSnapshots({
        baseline: baseline.snapshot,
        incoming: snapshot,
        baselineVersionId,
        assetPrefix: randomUUID().replace(/-/g, ""),
        frameMatches,
      });
      if (!merged) return jsonResponse({ error: "This capture scope cannot be merged. Capture the full file to replace this handoff." }, { status: 400 });
      const finalized = await createSnapshotEnvelope(merged.snapshot);
      if (!finalized.success) {
        return jsonResponse({ error: "The merged capture does not match the structured snapshot format.", issues: finalized.error.issues.slice(0, 30) }, { status: 400 });
      }
      if (Buffer.byteLength(JSON.stringify(finalized.data), "utf8") > maxSnapshotJsonBytes) {
        return jsonResponse({ error: "The merged structured snapshot exceeds Handoff’s 128 MiB JSON limit. Capture fewer frames in each update." }, { status: 413 });
      }

      versionSnapshot = finalized.data;
      reuseAssetsFromVersionId = baselineVersionId;
      const uploadedByKey = new Map(assets.map((asset) => [asset.key, asset] as const));
      const baselineByKey = new Map(baseline.assets.map((asset) => [asset.assetKey, asset] as const));
      const inheritedKeys = new Set(merged.inheritedAssetKeys);
      const incomingKeyByMergedKey = new Map([...merged.incomingAssetKeyMap].map(([incomingKey, mergedKey]) => [mergedKey, incomingKey] as const));
      versionAssets = finalized.data.assets.map((asset): VersionAssetInput => {
        if (inheritedKeys.has(asset.key)) {
          const previous = baselineByKey.get(asset.key);
          if (!previous) throw new Error(`The baseline asset "${asset.fileName}" could not be reused.`);
          return { ...asset, reuseObjectKey: previous.objectKey };
        }
        const sourceKey = incomingKeyByMergedKey.get(asset.key);
        const uploaded = sourceKey ? uploadedByKey.get(sourceKey) : undefined;
        if (!uploaded?.bytes) throw new Error(`The captured asset "${asset.fileName}" could not be matched to its upload.`);
        const duplicate = findReusableAsset(asset, baseline.assets);
        return duplicate
          ? { ...asset, reuseObjectKey: duplicate.objectKey }
          : { ...asset, bytes: uploaded.bytes };
      });
    }

    const created = await createHandoffVersion({
      workspaceId: session.workspaceId,
      projectId: session.projectId,
      handoffId: session.handoffId ?? undefined,
      handoffName: session.handoffName ?? undefined,
      versionLabel: session.versionLabel,
      releaseNote: session.releaseNote,
      createdBy: session.createdBy,
      expectedLatestVersionId: baselineVersionId ?? undefined,
      snapshot: versionSnapshot,
      assets: versionAssets,
      reuseAssetsFromVersionId,
      consumeCaptureSessionId: session.id,
      frameReplacementMatches: frameMatches.length && baselineVersionId
        ? { baselineVersionId, matches: frameMatches }
        : undefined,
    });
    const origin = process.env.BETTER_AUTH_URL || new URL(request.url).origin;
    const reviewUrl = new URL(`/workspace/${encodeURIComponent(session.workspaceId)}/projects/${encodeURIComponent(session.projectId)}/handoffs/${encodeURIComponent(created.handoffId)}?versionId=${encodeURIComponent(created.versionId)}`, origin).toString();
      return jsonResponse({ ...created, projectId: session.projectId, reviewUrl }, { status: 201 });
  } catch (error) {
    if (error instanceof HandoffVersionConflictError) {
      return jsonResponse({ error: error.message }, { status: 409 });
    }
    if (error instanceof Error && /Capture session expired|already used|no longer matches/i.test(error.message)) {
      return jsonResponse({ error: error.message }, { status: 401 });
    }
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      return jsonResponse({ error: "A handoff with that name and version already exists." }, { status: 409 });
    }
    return jsonResponse({ error: error instanceof Error ? error.message : "Could not store this Figma capture." }, { status: 400 });
  }
}
