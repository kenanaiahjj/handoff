import { z } from "zod";
import { getCaptureSession } from "@/src/server/repositories/capture-sessions";
import { createHandoffVersion, getVersion, type VersionAssetInput } from "@/src/server/repositories/versions";
import { getDatabase } from "@/src/server/db";
import { diffSnapshots } from "@/src/server/services/diff";
import { parseUploadForm, SnapshotImportError, verifyRenderAssetBytes } from "@/src/server/services/import-snapshot";
import { snapshotEnvelopeSchema } from "@asbir/snapshot-contract";

const maxAssetsBytes = 100 * 1024 * 1024;
const maxSnapshotJsonBytes = 16 * 1024 * 1024;
const supportedContentTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const frameMatchesSchema = z.array(z.object({
  beforeFrameId: z.string().trim().min(1).max(200),
  afterFrameId: z.string().trim().min(1).max(200),
}).strict()).max(100);

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
  if (new TextEncoder().encode(serializedSnapshot).byteLength > maxSnapshotJsonBytes) {
    return jsonResponse({ error: "The structured snapshot exceeds the 16 MiB JSON limit." }, { status: 413 });
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
  if (snapshot.assets.length > 300) return jsonResponse({ error: "A capture can contain at most 300 render assets." }, { status: 413 });

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
  if (!frameMatches.length && baselineVersionId) return jsonResponse({ error: "A baseline version is only needed when confirming frame replacements." }, { status: 400 });

  if (frameMatches.length) {
    if (!session.handoffId || !baselineVersionId) return jsonResponse({ error: "A previous handoff version is required to confirm frame replacements." }, { status: 400 });
    const latest = getDatabase()
      .prepare(
        `SELECT id FROM handoff_version
         WHERE workspace_id = ? AND handoff_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(session.workspaceId, session.handoffId) as { id: string } | undefined;
    if (latest?.id !== baselineVersionId) {
      return jsonResponse({ error: "The handoff changed while you reviewed frame replacements. Capture again to compare with the latest version." }, { status: 409 });
    }
    const baseline = getVersion({ workspaceId: session.workspaceId, versionId: baselineVersionId });
    if (!baseline) return jsonResponse({ error: "The replacement baseline could not be loaded." }, { status: 409 });
    const candidateDiff = diffSnapshots(
      { versionId: baseline.id, snapshot: baseline.snapshot },
      { versionId: "incoming-capture", snapshot },
    );
    const allowedPairs = new Set(candidateDiff.unmatchedFrameCandidates.flatMap((candidate) =>
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
    if (totalBytes > maxAssetsBytes) return jsonResponse({ error: "This capture exceeds the 100 MiB upload limit." }, { status: 413 });
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
    const created = await createHandoffVersion({
      workspaceId: session.workspaceId,
      projectId: session.projectId,
      handoffId: session.handoffId ?? undefined,
      handoffName: session.handoffName ?? undefined,
      versionLabel: session.versionLabel,
      releaseNote: session.releaseNote,
      createdBy: session.createdBy,
      snapshot,
      assets,
      consumeCaptureSessionId: session.id,
      frameReplacementMatches: frameMatches.length && baselineVersionId
        ? { baselineVersionId, matches: frameMatches }
        : undefined,
    });
    const origin = process.env.BETTER_AUTH_URL || new URL(request.url).origin;
    const reviewUrl = new URL(`/workspace/${encodeURIComponent(session.workspaceId)}/projects/${encodeURIComponent(session.projectId)}/handoffs/${encodeURIComponent(created.handoffId)}?versionId=${encodeURIComponent(created.versionId)}`, origin).toString();
      return jsonResponse({ ...created, projectId: session.projectId, reviewUrl }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /Capture session expired|already used|no longer matches/i.test(error.message)) {
      return jsonResponse({ error: error.message }, { status: 401 });
    }
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      return jsonResponse({ error: "A handoff with that name and version already exists." }, { status: 409 });
    }
    return jsonResponse({ error: error instanceof Error ? error.message : "Could not store this Figma capture." }, { status: 400 });
  }
}
