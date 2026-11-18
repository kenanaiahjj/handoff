import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { MAX_CAPTURE_ASSET_BYTES, MAX_SNAPSHOT_JSON_BYTES } from "@asbir/snapshot-contract";
import { getCaptureSession, isCaptureSessionExpired } from "@/src/server/repositories/capture-sessions";
import { getDatabase } from "@/src/server/db";
import { mapWithConcurrency } from "@/src/server/map-with-concurrency";
import { getSupabaseStorageUrl, objectStore } from "@/src/server/storage/supabase-object-store";

const supportedContentTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const assetSchema = z.object({
  assetKey: z.string().trim().min(1).max(200),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(100),
  sizeBytes: z.number().int().nonnegative().max(MAX_CAPTURE_ASSET_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const requestSchema = z.object({
  snapshot: z.object({
    sizeBytes: z.number().int().positive().max(MAX_SNAPSHOT_JSON_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  assets: z.array(assetSchema).max(20_000),
  renew: z.boolean().optional(),
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

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.match(/^Bearer\s+(asbir_capture_[A-Za-z0-9_-]{32,})$/)?.[1];
  if (!token) return jsonResponse({ error: "A valid capture token is required." }, { status: 401 });

  const session = await getCaptureSession(token);
  if (!session) {
    const expired = await isCaptureSessionExpired(token);
    return jsonResponse({
      error: expired ? "Renew this active capture before uploading." : "This capture token is invalid, already used, or no longer authorized.",
      code: expired ? "capture_token_expired" : "invalid_capture_token",
    }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 1_000_000) {
    return jsonResponse({ error: "The upload declaration exceeds its 1 MB limit." }, { status: 413 });
  }
  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: "Send valid upload declarations as JSON." }, { status: 400 }); }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return jsonResponse({ error: "The snapshot or asset upload declarations are invalid." }, { status: 400 });
  if (parsed.data.assets.some((asset) => !supportedContentTypes.has(asset.contentType))) {
    return jsonResponse({ error: "Use PNG, JPEG, WebP, or SVG render assets." }, { status: 415 });
  }
  const assetKeys = new Set(parsed.data.assets.map((asset) => asset.assetKey));
  if (assetKeys.size !== parsed.data.assets.length) return jsonResponse({ error: "Asset keys must be unique." }, { status: 400 });
  const totalAssetBytes = parsed.data.assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);
  if (totalAssetBytes > MAX_CAPTURE_ASSET_BYTES) return jsonResponse({ error: "This capture exceeds Handoff’s 256 MiB asset limit." }, { status: 413 });

  const database = getDatabase();
  const now = new Date().toISOString();
  let declaredUploads: Array<{ kind: "snapshot" | "asset"; assetKey: string | null; objectKey: string; fileName: string; contentType: string; sizeBytes: number; sha256: string }>;
  try {
    declaredUploads = await database.transaction(async () => {
      const rows = (await database
        .prepare(
          `SELECT id, upload_kind AS kind, asset_key AS assetKey, object_key AS objectKey,
                  file_name AS fileName, content_type AS contentType,
                  size_bytes AS sizeBytes, sha256, finalized_at AS finalizedAt
           FROM capture_upload WHERE capture_session_id = ? AND is_current FOR UPDATE`,
        )
        .all(session.id)) as Array<{
          kind: "snapshot" | "asset";
          id: string;
          assetKey: string | null;
          objectKey: string;
          fileName: string;
          contentType: string;
          sizeBytes: number;
          sha256: string;
          finalizedAt: string | null;
        }>;
      if (rows.some((row) => row.finalizedAt)) throw new Error("Capture uploads have already been finalized.");

      const declarations = [
        { kind: "snapshot" as const, assetKey: null, fileName: "snapshot.json", contentType: "application/json", ...parsed.data.snapshot },
        ...parsed.data.assets.map((asset) => ({ kind: "asset" as const, ...asset })),
      ];
      const result: typeof declaredUploads = [];

      if (parsed.data.renew && rows.length) {
        const deleteAfter = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
        for (const row of rows) {
          await database.prepare(
            "INSERT INTO capture_upload_abandoned (object_key, created_at, delete_after) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
          ).run(row.objectKey, now, deleteAfter);
          await database.prepare(
            "UPDATE capture_upload SET is_current = false WHERE id = ? AND is_current AND finalized_at IS NULL",
          ).run(row.id);
        }

        for (const declaration of declarations) {
          const objectKey = randomBytes(24).toString("hex");
          await database.prepare(
            `INSERT INTO capture_upload
              (id, capture_session_id, upload_kind, asset_key, object_key, file_name, content_type, size_bytes, sha256, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(randomUUID(), session.id, declaration.kind, declaration.assetKey, objectKey, declaration.fileName,
            declaration.contentType, declaration.sizeBytes, declaration.sha256, now);
          result.push({ ...declaration, objectKey });
        }
        return result;
      }

      if (rows.length && rows.length !== declarations.length) {
        throw new Error("The upload declaration set changed after upload began. Renew the upload credentials and try again.");
      }

      const existingByIdentity = new Map(rows.map((row) => [`${row.kind}:${row.assetKey ?? ""}`, row]));
      for (const declaration of declarations) {
        const identity = `${declaration.kind}:${declaration.assetKey ?? ""}`;
        const existing = existingByIdentity.get(identity);
        if (existing && (
          existing.fileName !== declaration.fileName || existing.contentType !== declaration.contentType ||
          existing.sizeBytes !== declaration.sizeBytes || existing.sha256 !== declaration.sha256
        )) {
          throw new Error("An upload declaration changed after upload began. Renew the upload credentials and try again.");
        }
        const objectKey = existing?.objectKey ?? randomBytes(24).toString("hex");
        if (!existing) {
          await database.prepare(
            `INSERT INTO capture_upload
              (id, capture_session_id, upload_kind, asset_key, object_key, file_name, content_type, size_bytes, sha256, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(randomUUID(), session.id, declaration.kind, declaration.assetKey, objectKey, declaration.fileName,
            declaration.contentType, declaration.sizeBytes, declaration.sha256, now);
        }
        result.push({ ...declaration, objectKey });
      }

      return result;
    })();
  } catch (error) {
    if (error instanceof Error && /already been finalized|declaration set changed|declaration changed/.test(error.message)) {
      return jsonResponse({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  try {
    const expiredObjects = (await database
      .prepare("SELECT object_key AS objectKey FROM capture_upload_abandoned WHERE delete_after <= ? ORDER BY delete_after LIMIT 50")
      .all(new Date().toISOString())) as Array<{ objectKey: string }>;
    const cleanupResults = await Promise.allSettled(expiredObjects.map(({ objectKey }) => objectStore.delete(objectKey)));
    const cleanedKeys = expiredObjects.filter((_, index) => cleanupResults[index].status === "fulfilled").map(({ objectKey }) => objectKey);
    if (cleanedKeys.length) {
      const placeholders = cleanedKeys.map(() => "?").join(", ");
      await database.prepare(`DELETE FROM capture_upload_abandoned WHERE object_key IN (${placeholders})`).run(...cleanedKeys);
    }

    const signedUploads = await mapWithConcurrency(declaredUploads, 4, async (upload) => {
      const signed = await objectStore.createSignedUploadUrl(upload.objectKey);
      return {
        kind: upload.kind,
        ...(upload.assetKey ? { assetKey: upload.assetKey } : {}),
        path: upload.objectKey,
        token: signed.token,
      };
    });
    const snapshot = signedUploads.find((upload) => upload.kind === "snapshot")!;
    const uploads = signedUploads.filter((upload) => upload.kind === "asset");
    return jsonResponse({
      storageUrl: getSupabaseStorageUrl(),
      bucket: process.env.SUPABASE_STORAGE_BUCKET?.trim() || "handoff-assets",
      ...(process.env.NODE_ENV === "development" && process.env.ASBIR_LOCAL_DEV_MODE === "1"
        ? { uploadProtocol: "direct" }
        : {}),
      snapshot: { path: snapshot.path, token: snapshot.token },
      uploads: uploads.map(({ kind: _kind, ...upload }) => upload),
      constraints: {
        maxSnapshotBytes: MAX_SNAPSHOT_JSON_BYTES,
        maxAssetBytes: MAX_CAPTURE_ASSET_BYTES,
        maxTotalAssetBytes: MAX_CAPTURE_ASSET_BYTES,
        resumableThresholdBytes: 6 * 1024 * 1024,
        tusChunkBytes: 6 * 1024 * 1024,
      },
    });
  } catch (error) {
    console.error("[capture uploads] Could not create Storage upload credentials:", error instanceof Error ? error.message : error);
    return jsonResponse({ error: "Could not create the Storage upload credentials. Retry the upload request." }, { status: 503 });
  }
}
