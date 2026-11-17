import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getDatabase, isUniqueConstraintViolation } from "@/src/server/db";
import { createHandoffVersion, type CreateHandoffVersionInput } from "@/src/server/repositories/versions";
import {
  importImageOnly,
  importSnapshotPackage,
  MAX_UPLOAD_BYTES,
  SnapshotImportError,
} from "@/src/server/services/import-snapshot";
import { getSupabaseStorageUrl, objectStore } from "@/src/server/storage/supabase-object-store";
import type { ObjectStore } from "@/src/server/storage/object-store";
type ProjectAuthorizer = typeof import("@/src/server/workspace-access").requireProjectMember;
type ProjectMemberAccessError = Error & { status: 401 | 403 | 404 };

const MAX_INTENT_BODY_BYTES = 128_000;
const PACKAGE_UPLOAD_LIFETIME_MS = 2 * 60 * 60 * 1000;
const intentSchema = z.object({
  workspaceId: z.string().trim().min(1).max(200),
  projectId: z.string().trim().min(1).max(200),
  handoffId: z.string().trim().min(1).max(200).nullable().optional(),
  handoffName: z.string().trim().max(100).nullable().optional(),
  versionLabel: z.string().trim().min(1).max(80),
  releaseNote: z.string().trim().max(4000).nullable().optional(),
  fileName: z.string().trim().min(1).max(512),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

type Database = ReturnType<typeof getDatabase>;
type ProjectAccess = Awaited<ReturnType<ProjectAuthorizer>>;
type StoredUpload = {
  id: string;
  workspaceId: string;
  projectId: string;
  handoffId: string | null;
  handoffName: string | null;
  versionLabel: string;
  releaseNote: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  objectKey: string;
  createdByUserId: string;
  expiresAt: string;
  finalizedAt: string | null;
  objectDeletedAt: string | null;
  resultHandoffId: string | null;
  resultVersionId: string | null;
};

type UploadDependencies = {
  getDatabase: () => Database;
  requireProjectMember: ProjectAuthorizer;
  storage: Pick<ObjectStore, "createSignedUploadUrl" | "get" | "delete">;
  getStorageUrl: () => string;
  getObjectInfo: (objectKey: string) => Promise<{ size: number; contentType: string } | null>;
  importSnapshotPackage: typeof importSnapshotPackage;
  importImageOnly: typeof importImageOnly;
  createHandoffVersion: typeof createHandoffVersion;
};

type UploadOverrides = Partial<UploadDependencies>;

const defaultRequireProjectMember: ProjectAuthorizer = (...args) =>
  import("@/src/server/workspace-access").then(({ requireProjectMember }) => requireProjectMember(...args));

function isProjectMemberAccessError(error: unknown): error is ProjectMemberAccessError {
  if (!(error instanceof Error) || error.name !== "WorkspaceAccessError") return false;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403 || status === 404;
}

function expectedContentType(fileName: string) {
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  switch (extension) {
    case "zip": return "application/zip";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "svg": return "image/svg+xml";
    default: return null;
  }
}

function canonicalFileName(value: string) {
  const fileName = value.split(/[\\/]/).at(-1)?.trim() ?? "";
  if (!fileName || fileName.length > 255 || /[\0-\x1f\x7f]/.test(fileName)) return null;
  return fileName;
}

async function readIntentJson(request: Request) {
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? Number.NaN : Number(contentLengthHeader);
  if (Number.isFinite(contentLength) && contentLength > MAX_INTENT_BODY_BYTES) {
    throw new SnapshotImportError("The upload preparation request is too large.", 413);
  }
  if (!request.body) throw new SnapshotImportError("Send upload details as JSON.", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_INTENT_BODY_BYTES) {
        await reader.cancel();
        throw new SnapshotImportError("The upload preparation request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new SnapshotImportError("Send upload details as valid JSON.", 400);
  }
}

function storageBucket() {
  return process.env.SUPABASE_STORAGE_BUCKET?.trim() || "handoff-assets";
}

function storageClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) throw new Error("Supabase Storage is not configured.");
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "asbir-handoff-server" } },
  });
}

async function getStorageObjectInfo(objectKey: string) {
  if (process.env.NODE_ENV === "development" && process.env.ASBIR_LOCAL_DEV_MODE === "1") {
    const stored = await objectStore.get(objectKey);
    return stored ? { size: stored.bytes.byteLength, contentType: stored.contentType } : null;
  }

  const { data, error } = await storageClient().storage.from(storageBucket()).info(objectKey);
  if (error) {
    const status = "statusCode" in error ? Number(error.statusCode) : Number.NaN;
    if (status === 404 || /not found/i.test(error.message)) return null;
    throw error;
  }
  const size = Number(data.size);
  if (!Number.isSafeInteger(size) || typeof data.contentType !== "string") {
    throw new Error("Supabase Storage returned invalid object metadata.");
  }
  return { size, contentType: data.contentType };
}

async function cleanupExpiredUploads(database: Database, storage: UploadDependencies["storage"], now: string) {
  const expired = (await database.prepare(
    `SELECT id, object_key AS objectKey
     FROM package_import_upload
     WHERE finalized_at IS NULL AND expires_at <= ?
     ORDER BY expires_at ASC
     LIMIT 50`,
  ).all(now)) as Array<{ id: string; objectKey: string }>;

  const results = await Promise.allSettled(expired.map(({ objectKey }) => storage.delete(objectKey)));
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      await database.prepare(
        "DELETE FROM package_import_upload WHERE id = ? AND finalized_at IS NULL AND expires_at <= ?",
      ).run(expired[index].id, now);
    }
  }

  const finalized = (await database.prepare(
    `SELECT id, object_key AS objectKey
     FROM package_import_upload
     WHERE finalized_at IS NOT NULL AND object_deleted_at IS NULL
     ORDER BY finalized_at ASC
     LIMIT 50`,
  ).all()) as Array<{ id: string; objectKey: string }>;
  const finalizedResults = await Promise.allSettled(finalized.map(({ objectKey }) => storage.delete(objectKey)));
  for (const [index, result] of finalizedResults.entries()) {
    if (result.status === "fulfilled") {
      await database.prepare(
        "UPDATE package_import_upload SET object_deleted_at = ? WHERE id = ? AND object_deleted_at IS NULL",
      ).run(now, finalized[index].id);
    }
  }
}

async function deleteFinalizedUploadObject(database: Database, storage: UploadDependencies["storage"], row: StoredUpload) {
  if (row.objectDeletedAt) return;
  try {
    await storage.delete(row.objectKey);
    await database.prepare(
      "UPDATE package_import_upload SET object_deleted_at = ? WHERE id = ? AND object_deleted_at IS NULL",
    ).run(new Date().toISOString(), row.id);
  } catch {
    // A later upload intent retries cleanup for finalized staged objects.
  }
}

function uploadSelect() {
  return `SELECT id, workspace_id AS workspaceId, project_id AS projectId,
          handoff_id AS handoffId, handoff_name AS handoffName,
          version_label AS versionLabel, release_note AS releaseNote,
          file_name AS fileName, content_type AS contentType, size_bytes AS sizeBytes,
          sha256, object_key AS objectKey, created_by_user_id AS createdByUserId,
          expires_at AS expiresAt, finalized_at AS finalizedAt,
          object_deleted_at AS objectDeletedAt,
          result_handoff_id AS resultHandoffId, result_version_id AS resultVersionId
          FROM package_import_upload`;
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

function storedResult(row: StoredUpload) {
  return { handoffId: row.resultHandoffId!, versionId: row.resultVersionId! };
}

function asFile(bytes: Uint8Array, fileName: string, contentType: string) {
  return {
    name: fileName,
    type: contentType,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer,
  } as File;
}

export function createPackageImportHandlers(overrides: UploadOverrides = {}) {
  const dependencies: UploadDependencies = {
    getDatabase,
    requireProjectMember: defaultRequireProjectMember,
    storage: objectStore,
    getStorageUrl: getSupabaseStorageUrl,
    getObjectInfo: getStorageObjectInfo,
    importSnapshotPackage,
    importImageOnly,
    createHandoffVersion,
    ...overrides,
  };

  async function createIntent(request: Request) {
    try {
      const parsed = intentSchema.safeParse(await readIntentJson(request));
      if (!parsed.success) return jsonError("Enter a handoff, version label, file name, size, and SHA-256 checksum.", 400);
      const input = parsed.data;
      if (input.sizeBytes > MAX_UPLOAD_BYTES) {
        return jsonError("The upload is larger than 100 MB.", 413);
      }
      const fileName = canonicalFileName(input.fileName);
      if (!fileName) return jsonError("The uploaded file name is invalid.", 400);
      const contentType = expectedContentType(fileName);
      if (!contentType) return jsonError("Upload a ZIP, PNG, JPEG, WebP, or SVG file.", 415);
      const handoffId = input.handoffId || null;
      const handoffName = handoffId ? null : input.handoffName?.trim() || null;
      if (!handoffId && !handoffName) return jsonError("Enter a handoff name.", 400);

      const access = await dependencies.requireProjectMember(
        request,
        input.workspaceId,
        input.projectId,
        { manage: true },
      );
      const database = dependencies.getDatabase();
      if (handoffId) {
        const handoff = await database.prepare(
          "SELECT 1 FROM handoff WHERE id = ? AND workspace_id = ? AND project_id = ?",
        ).get(handoffId, input.workspaceId, input.projectId);
        if (!handoff) return jsonError("Handoff not found.", 404);
      }

      const now = new Date();
      const createdAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + PACKAGE_UPLOAD_LIFETIME_MS).toISOString();
      const uploadId = randomUUID();
      const objectKey = randomBytes(24).toString("hex");
      await cleanupExpiredUploads(database, dependencies.storage, createdAt);
      await database.prepare(
        `INSERT INTO package_import_upload
          (id, workspace_id, project_id, handoff_id, handoff_name, version_label, release_note,
           file_name, content_type, size_bytes, sha256, object_key, created_by_user_id,
           created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        uploadId,
        input.workspaceId,
        input.projectId,
        handoffId,
        handoffName,
        input.versionLabel.trim(),
        input.releaseNote?.trim() || null,
        fileName,
        contentType,
        input.sizeBytes,
        input.sha256,
        objectKey,
        access.userId,
        createdAt,
        expiresAt,
      );

      const signed = await dependencies.storage.createSignedUploadUrl(objectKey);
      return Response.json({
        uploadId,
        storageUrl: dependencies.getStorageUrl(),
        bucket: storageBucket(),
        ...(process.env.NODE_ENV === "development" && process.env.ASBIR_LOCAL_DEV_MODE === "1"
          ? { uploadProtocol: "direct" as const }
          : {}),
        path: objectKey,
        token: signed.token,
        contentType,
        expiresAt,
      }, { status: 201 });
    } catch (error) {
      if (isProjectMemberAccessError(error)) return jsonError(error.message, error.status);
      if (error instanceof SnapshotImportError) return jsonError(error.message, error.status);
      throw error;
    }
  }

  async function finalize(request: Request, uploadId: string) {
    try {
      if (!/^[0-9a-f-]{36}$/i.test(uploadId)) return { response: jsonError("Upload not found.", 404) };
      const database = dependencies.getDatabase();
      const row = (await database.prepare(`${uploadSelect()} WHERE id = ?`).get(uploadId)) as StoredUpload | undefined;
      if (!row) return { response: jsonError("Upload not found.", 404) };

      const access: ProjectAccess = await dependencies.requireProjectMember(
        request,
        row.workspaceId,
        row.projectId,
        { manage: true },
      );
      if (access.userId !== row.createdByUserId) return { response: jsonError("Upload not found.", 404) };
      if (row.finalizedAt) {
        await deleteFinalizedUploadObject(database, dependencies.storage, row);
        return { response: Response.json(storedResult(row), { status: 200 }) };
      }

      const now = new Date().toISOString();
      if (row.expiresAt <= now) {
        await dependencies.storage.delete(row.objectKey).catch(() => undefined);
        await database.prepare(
          "DELETE FROM package_import_upload WHERE id = ? AND finalized_at IS NULL AND expires_at <= ?",
        ).run(row.id, now);
        return { response: jsonError("This upload expired. Start the upload again.", 410) };
      }

      const info = await dependencies.getObjectInfo(row.objectKey);
      if (!info) return { response: jsonError("Upload the file before finalizing it.", 409) };
      if (info.size > MAX_UPLOAD_BYTES) return { response: jsonError("The upload is larger than 100 MB.", 413) };
      if (info.size !== row.sizeBytes || info.contentType !== row.contentType) {
        return { response: jsonError("The uploaded file does not match its declared type or size.", 400) };
      }

      const object = await dependencies.storage.get(row.objectKey);
      if (!object) return { response: jsonError("Upload the file before finalizing it.", 409) };
      if (object.bytes.byteLength !== row.sizeBytes || object.contentType !== row.contentType) {
        return { response: jsonError("The uploaded file does not match its declared type or size.", 400) };
      }
      const actualHash = createHash("sha256").update(object.bytes).digest("hex");
      if (actualHash !== row.sha256) return { response: jsonError("The uploaded file checksum does not match.", 400) };

      const imported = row.fileName.toLowerCase().endsWith(".zip")
        ? await dependencies.importSnapshotPackage(object.bytes)
        : await dependencies.importImageOnly(asFile(object.bytes, row.fileName, row.contentType));

      const transactionResult = await database.transaction(async () => {
        const locked = (await database.prepare(`${uploadSelect()} WHERE id = ? FOR UPDATE`).get(row.id)) as StoredUpload | undefined;
        if (!locked) return { expired: false, result: null, replay: false };
        if (locked.finalizedAt) return { expired: false, result: storedResult(locked), replay: true };
        const committedAt = new Date().toISOString();
        if (locked.expiresAt <= committedAt) return { expired: true, result: null, replay: false };

        const versionInput: CreateHandoffVersionInput = {
          workspaceId: locked.workspaceId,
          projectId: locked.projectId,
          ...(locked.handoffId ? { handoffId: locked.handoffId } : { handoffName: locked.handoffName! }),
          versionLabel: locked.versionLabel,
          releaseNote: locked.releaseNote,
          createdBy: locked.createdByUserId,
          snapshot: imported.snapshot,
          assets: imported.assets,
        };
        const created = await dependencies.createHandoffVersion(versionInput);
        const updated = await database.prepare(
          `UPDATE package_import_upload
           SET finalized_at = ?, result_handoff_id = ?, result_version_id = ?
           WHERE id = ? AND finalized_at IS NULL`,
        ).run(committedAt, created.handoffId, created.versionId, locked.id);
        if (updated.changes !== 1) throw new Error("The upload could not be finalized safely.");
        return { expired: false, result: created, replay: false };
      })();

      if (transactionResult.expired) {
        await dependencies.storage.delete(row.objectKey).catch(() => undefined);
        await database.prepare(
          "DELETE FROM package_import_upload WHERE id = ? AND finalized_at IS NULL AND expires_at <= ?",
        ).run(row.id, new Date().toISOString());
        return { response: jsonError("This upload expired. Start the upload again.", 410) };
      }
      if (!transactionResult.result) return { response: jsonError("Upload not found.", 404) };
      await deleteFinalizedUploadObject(database, dependencies.storage, row);

      return {
        response: Response.json(transactionResult.result, { status: transactionResult.replay ? 200 : 201 }),
        ...(!transactionResult.replay ? {
          created: {
            workspaceId: row.workspaceId,
            handoffId: transactionResult.result.handoffId,
            versionId: transactionResult.result.versionId,
            createdBy: row.createdByUserId,
          },
        } : {}),
      };
    } catch (error) {
      if (isProjectMemberAccessError(error)) return { response: jsonError(error.message, error.status) };
      if (error instanceof SnapshotImportError) return { response: jsonError(error.message, error.status) };
      if (isUniqueConstraintViolation(error)) {
        return { response: jsonError("That handoff or version label already exists.", 409) };
      }
      throw error;
    }
  }

  return { createIntent, finalize };
}
