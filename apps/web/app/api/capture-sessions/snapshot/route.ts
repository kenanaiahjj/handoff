import { after } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { hashSnapshotPayload, MAX_CAPTURE_ASSET_BYTES, MAX_SNAPSHOT_JSON_BYTES, normalizeFigmaCaptureScope, snapshotEnvelopeSchema, type SnapshotEnvelope } from "@asbir/snapshot-contract";
import { notifyNewVersion } from "@/src/server/services/slack";
import {
  getCaptureSession,
  getFinalizedCaptureSession,
  isCaptureSessionExpired,
} from "@/src/server/repositories/capture-sessions";
import { createHandoffVersion, getVersion, HandoffVersionConflictError, type VersionAssetInput } from "@/src/server/repositories/versions";
import { getDatabase, isUniqueConstraintViolation } from "@/src/server/db";
import { createUnmatchedFramePairValidator, diffSnapshots } from "@/src/server/services/diff";
import { SnapshotImportError, verifyRenderAssetBytes } from "@/src/server/services/import-snapshot";
import { createSnapshotEnvelope } from "@asbir/snapshot-contract";
import { mergeFigmaCaptureSnapshots } from "@/src/server/services/merge-figma-capture";
import { findReusableAsset } from "@/src/server/services/reusable-assets";
import { primeCanvasCopy } from "@/src/server/services/version-canvas";
import { storeScreenCopiesLater } from "@/src/server/services/frame-store";
import { objectStore } from "@/src/server/storage/supabase-object-store";
import { mapWithConcurrency } from "@/src/server/map-with-concurrency";

/**
 * Large captures (250 MB of JSON) take tens of seconds to verify, merge and store. 300 s is the
 * highest limit every Vercel plan accepts; on Pro it can be raised to 800 here.
 */
export const maxDuration = 300;

const supportedContentTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const objectKeySchema = z.string().regex(/^[a-f0-9]{48}$/);
const frameMatchesSchema = z.array(z.object({
  beforeFrameId: z.string().trim().min(1).max(200),
  afterFrameId: z.string().trim().min(1).max(200),
}).strict()).max(5_000);
const finalizeSchema = z.object({
  snapshotPath: objectKeySchema,
  assets: z.record(z.string().trim().min(1).max(200), objectKeySchema).refine((value) => Object.keys(value).length <= 20_000),
  baselineVersionId: z.string().uuid().nullable().optional(),
  frameMatches: frameMatchesSchema.optional(),
  /** For a page capture: "replace" makes the captured page the whole new version instead of merging it. */
  pageMode: z.enum(["add", "replace"]).optional(),
}).strict();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "600",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, { ...init, headers: { ...corsHeaders, ...init.headers } });
}

function retryUploadResponse(message: string) {
  return jsonResponse({ error: message, code: "upload_integrity_failed", retryUpload: true }, { status: 409 });
}

const ASSET_VERIFY_CONCURRENCY = 8;

/** A failed check on one uploaded asset, carrying the response to send. */
class AssetCheckFailure extends Error {
  constructor(readonly response: Response) {
    super("Uploaded asset check failed.");
  }
}

/**
 * Deletes uploads no version uses. Uploaded renders become the version's own asset objects, so a key
 * that any version refers to is never deleted, even if this request failed (for example a duplicate
 * finalize that lost the race to another request for the same capture).
 */
async function cleanupObjects(keys: string[]) {
  let uniqueKeys = [...new Set(keys)];
  if (!uniqueKeys.length) return 0;
  try {
    const referenced = (await getDatabase()
      .prepare("SELECT DISTINCT object_key AS objectKey FROM handoff_asset WHERE object_key = ANY(?)")
      .all([uniqueKeys])) as Array<{ objectKey: string }>;
    const inUse = new Set(referenced.map((row) => row.objectKey));
    uniqueKeys = uniqueKeys.filter((key) => !inUse.has(key));
  } catch (error) {
    console.warn("[storage] Could not check which uploads are in use; keeping them all.", error);
    return 0;
  }
  const results = await Promise.allSettled(uniqueKeys.map((key) => objectStore.delete(key)));
  const failures = results.filter((result) => result.status === "rejected").length;
  if (failures) console.warn(`[storage] Could not delete ${failures} unreferenced capture upload(s).`);
  return failures;
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.match(/^Bearer\s+(asbir_capture_[A-Za-z0-9_-]{32,})$/)?.[1];
  if (!token) return jsonResponse({ error: "A valid capture token is required.", code: "invalid_capture_token" }, { status: 401 });

  const session = await getCaptureSession(token);
  if (!session) {
    const finalized = await getFinalizedCaptureSession(token);
    if (finalized) {
      await cleanupObjects([finalized.snapshotObjectKey]);
      const origin = process.env.BETTER_AUTH_URL || new URL(request.url).origin;
      const reviewUrl = new URL(
        `/projects/${encodeURIComponent(finalized.projectId)}/handoffs/${encodeURIComponent(finalized.handoffId)}?versionId=${encodeURIComponent(finalized.versionId)}`,
        origin,
      ).toString();
      return jsonResponse({ handoffId: finalized.handoffId, versionId: finalized.versionId, projectId: finalized.projectId, reviewUrl }, { status: 200 });
    }
    const expired = await isCaptureSessionExpired(token);
    return jsonResponse({
      error: expired ? "Renew this active capture before finalizing." : "This capture token is invalid, already used, or no longer authorized.",
      code: expired ? "capture_token_expired" : "invalid_capture_token",
    }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 1_000_000) {
    return jsonResponse({ error: "The finalization manifest exceeds its 1 MB limit." }, { status: 413 });
  }
  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: "Send valid upload paths as JSON." }, { status: 400 }); }
  const parsedManifest = finalizeSchema.safeParse(body);
  if (!parsedManifest.success) return jsonResponse({ error: "The finalization manifest is invalid." }, { status: 400 });
  const manifest = parsedManifest.data;
  const frameMatches = manifest.frameMatches ?? [];
  const assetPaths = manifest.assets;
  if (new Set(Object.values(assetPaths)).size !== Object.keys(assetPaths).length) {
    return jsonResponse({ error: "Each asset must use its own uploaded object path." }, { status: 400 });
  }

  const database = getDatabase();
  const declaredUploads = (await database
    .prepare(
      `SELECT upload_kind AS kind, asset_key AS assetKey, object_key AS objectKey,
              file_name AS fileName, content_type AS contentType,
              size_bytes AS sizeBytes, sha256
       FROM capture_upload
       WHERE capture_session_id = ? AND is_current AND finalized_at IS NULL`,
    )
    .all(session.id)) as Array<{
      kind: "snapshot" | "asset";
      assetKey: string | null;
      objectKey: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      sha256: string;
    }>;
  const snapshotUpload = declaredUploads.find((upload) => upload.kind === "snapshot");
  const assetUploads = new Map(declaredUploads
    .filter((upload) => upload.kind === "asset" && upload.assetKey !== null)
    .map((upload) => [upload.assetKey!, upload]));
  if (!snapshotUpload || snapshotUpload.objectKey !== manifest.snapshotPath ||
      assetUploads.size !== Object.keys(assetPaths).length ||
      Object.entries(assetPaths).some(([assetKey, objectKey]) => assetUploads.get(assetKey)?.objectKey !== objectKey)) {
    return jsonResponse({ error: "The uploaded objects do not match this capture session.", code: "upload_manifest_invalid" }, { status: 400 });
  }

  const uploadedSnapshot = await objectStore.get(snapshotUpload.objectKey);
  if (!uploadedSnapshot) return retryUploadResponse("The snapshot upload is missing. Upload it again.");
  const snapshotChecksum = createHash("sha256").update(uploadedSnapshot.bytes).digest("hex");
  const snapshotIsGzipped = snapshotUpload.contentType === "application/octet-stream";
  if (uploadedSnapshot.contentType !== snapshotUpload.contentType ||
      (snapshotUpload.contentType !== "application/json" && !snapshotIsGzipped) ||
      uploadedSnapshot.bytes.byteLength !== snapshotUpload.sizeBytes ||
      uploadedSnapshot.bytes.byteLength > MAX_SNAPSHOT_JSON_BYTES ||
      snapshotChecksum !== snapshotUpload.sha256) {
    return retryUploadResponse("The snapshot upload failed its size, content type, or checksum check.");
  }

  let snapshotJsonBytes: Buffer;
  try {
    snapshotJsonBytes = snapshotIsGzipped
      ? gunzipSync(uploadedSnapshot.bytes, { maxOutputLength: MAX_SNAPSHOT_JSON_BYTES })
      : Buffer.from(uploadedSnapshot.bytes);
  } catch (error) {
    const tooLarge = (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError;
    return tooLarge
      ? jsonResponse({ error: `The structured snapshot exceeds Handoff’s ${Math.round(MAX_SNAPSHOT_JSON_BYTES / (1024 * 1024))} MiB JSON limit. Capture fewer frames in each update.` }, { status: 413 })
      : jsonResponse({ error: "The uploaded snapshot could not be unzipped." }, { status: 400 });
  }
  let json: unknown;
  try { json = JSON.parse(snapshotJsonBytes.toString("utf8")); }
  catch { return jsonResponse({ error: "The uploaded snapshot is not valid JSON." }, { status: 400 }); }
  const parsedSnapshot = snapshotEnvelopeSchema.safeParse(json);
  if (!parsedSnapshot.success) {
    return jsonResponse({ error: "The Figma capture does not match the structured snapshot format.", issues: parsedSnapshot.error.issues.slice(0, 30) }, { status: 400 });
  }
  const snapshot = parsedSnapshot.data;
  if (snapshot.source !== "figma" || snapshot.sourceMetadata.sourceTool !== "figma") {
    return jsonResponse({ error: "This capture endpoint accepts Figma plugin snapshots." }, { status: 400 });
  }
  if (snapshot.contentHash !== await hashSnapshotPayload(snapshot)) {
    return jsonResponse({ error: "Snapshot content hash does not match its content." }, { status: 400 });
  }
  const snapshotAssetKeys = new Set(snapshot.assets.map((asset) => asset.key));
  if (snapshotAssetKeys.size !== snapshot.assets.length ||
      snapshotAssetKeys.size !== Object.keys(assetPaths).length ||
      [...snapshotAssetKeys].some((key) => !Object.hasOwn(assetPaths, key))) {
    return jsonResponse({ error: "The uploaded asset set does not match the snapshot." }, { status: 400 });
  }

  let totalAssetBytes = 0;
  for (const asset of snapshot.assets) {
    const upload = assetUploads.get(asset.key)!;
    if (upload.fileName !== asset.fileName || upload.contentType !== asset.contentType ||
        upload.sizeBytes !== asset.sizeBytes || upload.sha256 !== asset.sha256 ||
        !supportedContentTypes.has(upload.contentType)) {
      return jsonResponse({ error: `Upload metadata does not match snapshot asset "${asset.fileName}".` }, { status: 400 });
    }
    totalAssetBytes += upload.sizeBytes;
    if (totalAssetBytes > MAX_CAPTURE_ASSET_BYTES) return jsonResponse({ error: "This capture exceeds Handoff’s 256 MiB asset limit." }, { status: 413 });
  }
  // Read back and verify the uploads several at a time: one by one, hundreds of Storage round trips
  // could take most of the function's time limit. The first failed check stops the rest.
  let assets: VersionAssetInput[];
  try {
    assets = await mapWithConcurrency(snapshot.assets, ASSET_VERIFY_CONCURRENCY, async (asset) => {
      const upload = assetUploads.get(asset.key)!;
      const stored = await objectStore.get(upload.objectKey);
      if (!stored) throw new AssetCheckFailure(retryUploadResponse(`Render asset "${asset.fileName}" is missing. Upload it again.`));
      const checksum = createHash("sha256").update(stored.bytes).digest("hex");
      if (stored.contentType !== asset.contentType || stored.bytes.byteLength !== asset.sizeBytes || checksum !== asset.sha256) {
        throw new AssetCheckFailure(retryUploadResponse(`Render asset "${asset.fileName}" failed its size, content type, or checksum check.`));
      }
      try {
        const dimensions = verifyRenderAssetBytes(stored.bytes, asset.contentType, asset.fileName);
        if (dimensions && ((asset.width !== undefined && asset.width !== dimensions.width) || (asset.height !== undefined && asset.height !== dimensions.height))) {
          throw new AssetCheckFailure(jsonResponse({ error: `Render dimensions do not match for "${asset.fileName}".` }, { status: 400 }));
        }
      } catch (error) {
        if (error instanceof SnapshotImportError) throw new AssetCheckFailure(jsonResponse({ error: error.message }, { status: error.status }));
        throw error;
      }
      return { ...asset, bytes: stored.bytes, uploadedObjectKey: upload.objectKey };
    });
  } catch (error) {
    if (error instanceof AssetCheckFailure) return error.response;
    throw error;
  }

  const baselineVersionId = manifest.baselineVersionId ?? null;
  const captureScope = normalizeFigmaCaptureScope(snapshot.sourceMetadata.captureScope);
  const replacesWithPage = captureScope === "page" && manifest.pageMode === "replace";
  const isPartialCapture = captureScope === "selected" || (captureScope === "page" && !replacesWithPage);
  const latest = session.handoffId
    ? (await database
        .prepare(
          `SELECT id FROM handoff_version
           WHERE workspace_id = ? AND handoff_id = ?
           ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .get(session.workspaceId, session.handoffId)) as { id: string } | undefined
    : undefined;
  if (baselineVersionId && (!session.handoffId || latest?.id !== baselineVersionId)) {
    return jsonResponse({ error: "The handoff changed while you reviewed this capture. Capture again to compare with the latest version." }, { status: 409 });
  }
  if (replacesWithPage && latest && !baselineVersionId) {
    return jsonResponse({ error: "The latest handoff version is required to replace it with this page. Preview the capture again." }, { status: 409 });
  }
  if (isPartialCapture && latest && !baselineVersionId) {
    return jsonResponse({ error: "The latest handoff version is required to merge a selected-frame capture. Preview the capture again." }, { status: 409 });
  }
  if (frameMatches.length && (!session.handoffId || !baselineVersionId)) {
    return jsonResponse({ error: "A previous handoff version is required to confirm frame replacements." }, { status: 400 });
  }
  const baseline = baselineVersionId
    ? await getVersion({ workspaceId: session.workspaceId, versionId: baselineVersionId })
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
    const isEligibleFrameMatch = createUnmatchedFramePairValidator(candidateDiff, eligibleCandidates);
    const beforeIds = new Set<string>();
    const afterIds = new Set<string>();
    for (const match of frameMatches) {
      if (!isEligibleFrameMatch(match.beforeFrameId, match.afterFrameId) || beforeIds.has(match.beforeFrameId) || afterIds.has(match.afterFrameId)) {
        return jsonResponse({ error: "Choose each suggested old and new frame once." }, { status: 400 });
      }
      beforeIds.add(match.beforeFrameId);
      afterIds.add(match.afterFrameId);
    }
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
      if (Buffer.byteLength(JSON.stringify(finalized.data), "utf8") > MAX_SNAPSHOT_JSON_BYTES) {
        return jsonResponse({ error: `The merged structured snapshot exceeds Handoff’s ${Math.round(MAX_SNAPSHOT_JSON_BYTES / (1024 * 1024))} MiB JSON limit. Capture fewer frames in each update.` }, { status: 413 });
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
        if (!uploaded?.bytes || !uploaded.uploadedObjectKey) throw new Error(`The captured asset "${asset.fileName}" could not be matched to its upload.`);
        const duplicate = findReusableAsset(asset, baseline.assets);
        // The merged snapshot renames incoming assets ("overview" → "merge-…-overview"); the version's
        // asset rows must use the merged key, as before the migration, with the uploaded bytes.
        return duplicate
          ? { ...asset, reuseObjectKey: duplicate.objectKey }
          : { ...asset, bytes: uploaded.bytes, uploadedObjectKey: uploaded.uploadedObjectKey };
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
      // Parsed with the schema and hash-checked above, or rebuilt by createSnapshotEnvelope after a merge.
      snapshotVerified: true,
      consumeCaptureSessionId: session.id,
      captureUploadPaths: { snapshotKey: snapshotUpload.objectKey, assetKeys: assetPaths },
      frameReplacementMatches: frameMatches.length && baselineVersionId
        ? { baselineVersionId, matches: frameMatches }
        : undefined,
    });
    await primeCanvasCopy(created.versionId, versionSnapshot.contentHash, versionSnapshot);
    storeScreenCopiesLater(session.workspaceId, created.versionId, versionSnapshot);
    const origin = process.env.BETTER_AUTH_URL || new URL(request.url).origin;
    after(() => notifyNewVersion({ workspaceId: session.workspaceId, handoffId: created.handoffId, versionId: created.versionId, createdBy: session.createdBy }).catch((error) => console.warn("[slack]", error)));

    const usedUploadedKeys = new Set(versionAssets.flatMap((asset) => "uploadedObjectKey" in asset && asset.uploadedObjectKey ? [asset.uploadedObjectKey] : []));
    const unreferencedUploads = [snapshotUpload.objectKey, ...Object.values(assetPaths).filter((key) => !usedUploadedKeys.has(key))];
    await cleanupObjects(unreferencedUploads);

    const reviewUrl = new URL(`/projects/${encodeURIComponent(session.projectId)}/handoffs/${encodeURIComponent(created.handoffId)}?versionId=${encodeURIComponent(created.versionId)}`, origin).toString();
    return jsonResponse({ ...created, projectId: session.projectId, reviewUrl }, { status: 201 });
  } catch (error) {
    // A second finalize for the same capture (a double click, or a retry after a dropped connection
    // while the first was still saving) loses the race: answer with the version the first one saved.
    const finalizedMeanwhile = await getFinalizedCaptureSession(token).catch(() => null);
    if (finalizedMeanwhile) {
      const origin = process.env.BETTER_AUTH_URL || new URL(request.url).origin;
      const reviewUrl = new URL(
        `/projects/${encodeURIComponent(finalizedMeanwhile.projectId)}/handoffs/${encodeURIComponent(finalizedMeanwhile.handoffId)}?versionId=${encodeURIComponent(finalizedMeanwhile.versionId)}`,
        origin,
      ).toString();
      return jsonResponse({ handoffId: finalizedMeanwhile.handoffId, versionId: finalizedMeanwhile.versionId, projectId: finalizedMeanwhile.projectId, reviewUrl }, { status: 200 });
    }
    await cleanupObjects([snapshotUpload.objectKey, ...Object.values(assetPaths)]);
    if (error instanceof HandoffVersionConflictError) {
      return jsonResponse({ error: error.message }, { status: 409 });
    }
    if (error instanceof Error && /Capture session expired|already used|no longer matches/i.test(error.message)) {
      return jsonResponse({ error: error.message, code: "capture_token_expired" }, { status: 401 });
    }
    if (isUniqueConstraintViolation(error)) {
      return jsonResponse({ error: "A handoff with that name and version already exists." }, { status: 409 });
    }
    // Database and Storage errors carry internals (SQL, constraint names): log them, don't send them.
    if (!(error instanceof Error) || typeof (error as { code?: unknown }).code === "string" || error.message.startsWith("Supabase Storage ")) {
      console.error("[capture] Finalize failed:", error);
      return jsonResponse({ error: "Could not store this Figma capture. Try again in a moment." }, { status: 500 });
    }
    return jsonResponse({ error: error.message }, { status: 400 });
  }
}
