import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  hashSnapshotPayload,
  snapshotEnvelopeSchema,
  visualOnlySnapshotSchema,
  type SnapshotAsset,
  type SnapshotEnvelope,
  type VisualOnlySnapshot,
} from "@asbir/snapshot-contract";
import { getDatabase } from "../db";
import { compressSnapshot, readSnapshotJson, storeCompressedSnapshot } from "../storage/snapshot-store";
import { objectStore } from "../storage/supabase-object-store";
import {
  assertReusableAssetReferences,
  deleteHandoffVersionInDatabase,
} from "../services/handoff-lifecycle";
import {
  resolveFrameReplacementMatches,
  type ConfirmedFrameReplacement,
} from "../services/frame-replacements";
import {
  resolveNodeReplacementMatches,
  type ConfirmedNodeReplacement,
  type NodeMatch,
} from "../services/node-replacements";

export type StoredSnapshot = SnapshotEnvelope | VisualOnlySnapshot;

export type StoredVersionAsset = {
  id: string;
  assetKey: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
};

export type VersionAssetInput = SnapshotAsset & (
  | { bytes: Uint8Array; reuseObjectKey?: never; uploadedObjectKey?: never }
  | { bytes: Uint8Array; reuseObjectKey?: never; uploadedObjectKey: string }
  | { bytes?: never; reuseObjectKey: string; uploadedObjectKey?: never }
);

export type CreateHandoffVersionInput = {
  workspaceId: string;
  projectId: string;
  handoffId?: string;
  expectedLatestVersionId?: string;
  handoffName?: string;
  versionLabel: string;
  releaseNote?: string | null;
  createdBy: string;
  snapshot: StoredSnapshot;
  assets: VersionAssetInput[];
  reuseAssetsFromVersionId?: string;
  consumeCaptureSessionId?: string;
  captureUploadPaths?: { snapshotKey: string; assetKeys: Record<string, string> };
  /**
   * The caller already validated `snapshot` against its schema and confirmed its contentHash (for
   * example with createSnapshotEnvelope), so neither is repeated: on a 250 MB capture each costs
   * seconds and hundreds of megabytes.
   */
  snapshotVerified?: boolean;
  frameReplacementMatches?: {
    baselineVersionId: string;
    matches: Array<{ beforeFrameId: string; afterFrameId: string }>;
  };
};

export class HandoffVersionConflictError extends Error {
  constructor() {
    super("The handoff changed while the capture was being stored. Preview the capture again against the latest version.");
    this.name = "HandoffVersionConflictError";
  }
}

function isVisualOnly(snapshot: StoredSnapshot): snapshot is VisualOnlySnapshot {
  return "visualOnly" in snapshot && snapshot.visualOnly;
}

function validateStoredSnapshot(snapshot: StoredSnapshot) {
  const schema = isVisualOnly(snapshot)
    ? visualOnlySnapshotSchema
    : snapshotEnvelopeSchema;
  const parsed = schema.parse(snapshot);
  return parsed;
}

function bytesSha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertAssetBytes(snapshot: StoredSnapshot, assets: VersionAssetInput[]) {
  if (assets.length !== snapshot.assets.length) {
    throw new Error("Every snapshot asset must have an uploaded file.");
  }

  const uploadByKey = new Map(assets.map((asset) => [asset.key, asset]));
  if (uploadByKey.size !== assets.length) {
    throw new Error("Snapshot assets contain duplicate keys.");
  }

  for (const asset of snapshot.assets) {
    const uploaded = uploadByKey.get(asset.key);
    if (!uploaded) throw new Error(`Missing bytes for asset "${asset.key}".`);
    if (asset.fileName !== uploaded.fileName || asset.contentType !== uploaded.contentType) {
      throw new Error(`Asset metadata does not match for "${asset.key}".`);
    }
    if (uploaded.bytes) {
      if (asset.sizeBytes !== uploaded.bytes.byteLength || asset.sizeBytes !== uploaded.sizeBytes) {
        throw new Error(`Asset size does not match for "${asset.key}".`);
      }
      const digest = bytesSha256(uploaded.bytes);
      if (asset.sha256 !== digest || uploaded.sha256 !== digest) {
        throw new Error(`Asset checksum does not match for "${asset.key}".`);
      }
      if (uploaded.uploadedObjectKey && !/^[a-f0-9]{48}$/.test(uploaded.uploadedObjectKey)) {
        throw new Error(`Uploaded asset path is invalid for "${asset.key}".`);
      }
    } else if (!uploaded.reuseObjectKey || !/^[a-f0-9]{48}$/.test(uploaded.reuseObjectKey)) {
      throw new Error(`Asset bytes are missing for "${asset.key}".`);
    }
  }
}

export async function createHandoffVersion(input: CreateHandoffVersionInput) {
  const snapshot = input.snapshotVerified ? input.snapshot : validateStoredSnapshot(input.snapshot);
  const contentHash = input.snapshotVerified ? snapshot.contentHash : await hashSnapshotPayload(snapshot);
  if (snapshot.contentHash !== contentHash) {
    throw new Error("Snapshot content hash does not match its content.");
  }
  assertAssetBytes(snapshot, input.assets);
  // Compressed (and verified to read back) before the transaction, which holds the handoff's lock.
  const compressedSnapshot = compressSnapshot(snapshot);

  const database = getDatabase();
  const project = (await database
    .prepare("SELECT 1 FROM project WHERE id = ? AND workspace_id = ?")
    .get(input.projectId, input.workspaceId));
  if (!project) throw new Error("Project not found in this workspace.");

  if (input.handoffId) {
    const handoff = (await database
      .prepare(
        "SELECT 1 FROM handoff WHERE id = ? AND project_id = ? AND workspace_id = ?",
      )
      .get(input.handoffId, input.projectId, input.workspaceId));
    if (!handoff) throw new Error("Handoff not found in this project.");
  } else if (!input.handoffName?.trim()) {
    throw new Error("A handoff name is required for the first version.");
  }

  const now = new Date().toISOString();
  const newHandoffId = input.handoffId ?? randomUUID();
  const versionId = randomUUID();
  const reusedVersion = input.reuseAssetsFromVersionId
    ? (await database
        .prepare("SELECT handoff_id AS handoffId FROM handoff_version WHERE id = ? AND workspace_id = ?")
        .get(input.reuseAssetsFromVersionId, input.workspaceId)) as { handoffId: string } | undefined
    : undefined;
  if (input.reuseAssetsFromVersionId && reusedVersion?.handoffId !== newHandoffId) {
    throw new Error("Reusable assets must belong to an earlier version in this handoff.");
  }
  const storedAssets = await Promise.all(input.assets.map(async (asset) => {
    if (asset.bytes) {
      return {
        asset,
        id: randomUUID(),
        objectKey: asset.uploadedObjectKey ?? randomBytes(24).toString("hex"),
      };
    }
    if (!input.reuseAssetsFromVersionId) throw new Error("Reusable assets require a baseline handoff version.");
    const source = (await database
      .prepare(
        `SELECT file_name AS fileName, content_type AS contentType,
                size_bytes AS sizeBytes, sha256, width, height
         FROM handoff_asset
         WHERE workspace_id = ? AND handoff_version_id = ? AND object_key = ?`,
      )
      .get(input.workspaceId, input.reuseAssetsFromVersionId, asset.reuseObjectKey)) as
      | { fileName: string; contentType: string; sizeBytes: number; sha256: string; width: number | null; height: number | null }
      | undefined;
    if (!source || source.fileName !== asset.fileName || source.contentType !== asset.contentType ||
        source.sizeBytes !== asset.sizeBytes || source.sha256 !== asset.sha256 ||
        source.width !== (asset.width ?? null) || source.height !== (asset.height ?? null)) {
      throw new Error(`Reusable asset metadata does not match for "${asset.key}".`);
    }
    return {
      asset,
      id: randomUUID(),
      objectKey: asset.reuseObjectKey,
    };
  }));
  const writtenObjectKeys: string[] = [];

  try {
    for (const { asset, objectKey } of storedAssets) {
      if (!asset.bytes) continue;
      // Uploaded straight to Storage by the plugin. Never delete it here on failure: a finalize retry
      // that loses the race would remove the files of the version that won. The capture route cleans
      // up unreferenced uploads itself.
      if (asset.uploadedObjectKey) continue;
      await objectStore.put(objectKey, asset.bytes, asset.contentType);
      writtenObjectKeys.push(objectKey);
    }

    const insertVersion = database.transaction(async () => {
      let captureUploadsCount: number | null = null;
      // SQLite ran one writer at a time. Lock the handoff so concurrent publishes, deletes and asset
      // reuse checks for the same handoff happen in order instead of both passing their checks.
      if (input.handoffId) {
        (await database
          .prepare("SELECT id FROM handoff WHERE id = ? AND workspace_id = ? FOR UPDATE")
          .get(input.handoffId, input.workspaceId));
      }
      if (input.expectedLatestVersionId) {
        const latest = input.handoffId
          ? (await database
              .prepare(
                `SELECT id FROM handoff_version
                 WHERE workspace_id = ? AND handoff_id = ?
                 ORDER BY created_at DESC, id DESC LIMIT 1`,
              )
              .get(input.workspaceId, input.handoffId)) as { id: string } | undefined
          : undefined;
        if (latest?.id !== input.expectedLatestVersionId) {
          throw new HandoffVersionConflictError();
        }
      }

      if (input.reuseAssetsFromVersionId) {
        (await assertReusableAssetReferences(database, {
          workspaceId: input.workspaceId,
          handoffId: newHandoffId,
          sourceVersionId: input.reuseAssetsFromVersionId,
          objectKeys: input.assets.flatMap((asset) => asset.bytes ? [] : [asset.reuseObjectKey]),
        }));
      }

      if (input.consumeCaptureSessionId) {
        if (!input.captureUploadPaths) throw new Error("Capture upload paths are required before finalizing this session.");
        const declaredUploads = (await database
          .prepare(
            `SELECT upload_kind AS kind, asset_key AS assetKey, object_key AS objectKey
             FROM capture_upload
             WHERE capture_session_id = ? AND is_current AND finalized_at IS NULL
             FOR UPDATE`,
          )
          .all(input.consumeCaptureSessionId)) as Array<{ kind: string; assetKey: string | null; objectKey: string }>;
        const snapshotUpload = declaredUploads.find((upload) => upload.kind === "snapshot");
        const assetUploads = new Map(declaredUploads
          .filter((upload) => upload.kind === "asset" && upload.assetKey !== null)
          .map((upload) => [upload.assetKey!, upload.objectKey]));
        if (snapshotUpload?.objectKey !== input.captureUploadPaths.snapshotKey ||
            assetUploads.size !== Object.keys(input.captureUploadPaths.assetKeys).length ||
            Object.entries(input.captureUploadPaths.assetKeys).some(([key, objectKey]) => assetUploads.get(key) !== objectKey)) {
          throw new Error("The uploaded objects do not match this capture session.");
        }
        captureUploadsCount = declaredUploads.length;
        const consumed = (await database
          .prepare(
            `UPDATE capture_session SET used_at = ?
             WHERE id = ? AND workspace_id = ? AND project_id = ?
               AND (handoff_id IS NULL OR handoff_id = ?)
               AND used_at IS NULL AND expires_at > ?`,
          )
          .run(now, input.consumeCaptureSessionId, input.workspaceId, input.projectId, newHandoffId, now));
        if (consumed.changes !== 1) throw new Error("Capture session expired, was already used, or no longer matches this handoff.");
      }

      if (!input.handoffId) {
        (await database
          .prepare(
            `INSERT INTO handoff
              (id, workspace_id, project_id, name, created_by_user_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            newHandoffId,
            input.workspaceId,
            input.projectId,
            input.handoffName!.trim(),
            input.createdBy,
            now,
          ));
      }

      (await database
        .prepare(
          `INSERT INTO handoff_version
            (id, workspace_id, handoff_id, version_label, release_note, source,
             source_file_id, source_revision_id, captured_at, content_hash,
             visual_only, snapshot_json, created_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          input.workspaceId,
          newHandoffId,
          input.versionLabel.trim(),
          input.releaseNote?.trim() || null,
          snapshot.source,
          snapshot.sourceFileId,
          snapshot.sourceRevisionId,
          snapshot.capturedAt,
          contentHash,
            isVisualOnly(snapshot),
          "{}",
          input.createdBy,
          now,
        ));
      // The capture itself is stored compressed beside the row (verified to read back identically).
      (await storeCompressedSnapshot(database, versionId, compressedSnapshot));

      const insertAsset = database.prepare(
        `INSERT INTO handoff_asset
          (id, workspace_id, handoff_version_id, asset_key, object_key, file_name,
           content_type, size_bytes, sha256, width, height, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      for (const { asset, id, objectKey } of storedAssets) {
        await insertAsset.run(
          id,
          input.workspaceId,
          versionId,
          asset.key,
          objectKey,
          asset.fileName,
          asset.contentType,
          asset.sizeBytes,
          asset.sha256,
          asset.width ?? null,
          asset.height ?? null,
          now,
        );
      }

      if (input.frameReplacementMatches?.matches.length) {
        const baseline = (await database
          .prepare("SELECT id FROM handoff_version WHERE id = ? AND handoff_id = ? AND workspace_id = ?")
          .get(input.frameReplacementMatches.baselineVersionId, newHandoffId, input.workspaceId));
        if (!baseline) throw new Error("The confirmed replacement baseline is no longer in this handoff.");

        const insertReplacement = database.prepare(
          `INSERT INTO handoff_frame_replacement
            (handoff_id, workspace_id, baseline_version_id, new_version_id,
             before_frame_id, after_frame_id, confirmed_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const match of input.frameReplacementMatches.matches) {
          await insertReplacement.run(
            newHandoffId,
            input.workspaceId,
            input.frameReplacementMatches.baselineVersionId,
            versionId,
            match.beforeFrameId,
            match.afterFrameId,
            input.createdBy,
            now,
          );
        }
      }

      if (input.consumeCaptureSessionId && captureUploadsCount !== null) {
        const finalizedUploads = (await database
          .prepare("UPDATE capture_upload SET finalized_at = ?, version_id = ? WHERE capture_session_id = ? AND is_current AND finalized_at IS NULL")
          .run(now, versionId, input.consumeCaptureSessionId));
        if (finalizedUploads.changes !== captureUploadsCount) throw new Error("The capture upload set changed before finalization.");
      }
    });

    await insertVersion();
    return { handoffId: newHandoffId, versionId };
  } catch (error) {
    await Promise.all(writtenObjectKeys.map((key) => objectStore.delete(key)));
    throw error;
  }
}

type FrameIdentitySnapshot = {
  sourceFileId: string;
  frames: Array<{ sourceFrameId: string }>;
};

export class FrameReplacementConflictError extends Error {
  constructor() {
    super("This screen is already matched to another screen in that version.");
    this.name = "FrameReplacementConflictError";
  }
}

type FrameReplacementMatchInput = {
  workspaceId: string;
  handoffId: string;
  baselineVersionId: string;
  newVersionId: string;
  beforeFrameId: string;
  afterFrameId: string;
  confirmedByUserId: string;
};

export async function hasConfirmedFrameReplacementMatch(input: Omit<FrameReplacementMatchInput, "confirmedByUserId">) {
  return Boolean((await getDatabase()
    .prepare(
      `SELECT 1 FROM handoff_frame_replacement
       WHERE workspace_id = ? AND handoff_id = ?
         AND baseline_version_id = ? AND new_version_id = ?
         AND before_frame_id = ? AND after_frame_id = ?`,
    )
    .get(
      input.workspaceId,
      input.handoffId,
      input.baselineVersionId,
      input.newVersionId,
      input.beforeFrameId,
      input.afterFrameId,
    )));
}

export async function createConfirmedFrameReplacementMatch(input: FrameReplacementMatchInput) {
  const database = getDatabase();
  const confirmMatch = database.transaction(async () => {
    const versions = (await database
      .prepare(
        `SELECT id FROM handoff_version
         WHERE workspace_id = ? AND handoff_id = ? AND id IN (?, ?)
         ORDER BY created_at ASC, id ASC`,
      )
      .all(input.workspaceId, input.handoffId, input.baselineVersionId, input.newVersionId)) as Array<{ id: string }>;
    if (versions.length !== 2 || versions[0].id !== input.baselineVersionId) {
      throw new Error("Choose two versions in the same handoff, with the earlier version as the baseline.");
    }

    const existing = (await database
      .prepare(
        `SELECT baseline_version_id AS baselineVersionId, before_frame_id AS beforeFrameId,
                after_frame_id AS afterFrameId
         FROM handoff_frame_replacement
         WHERE workspace_id = ? AND handoff_id = ? AND new_version_id = ?
           AND (before_frame_id = ? OR after_frame_id = ?)`,
      )
      .all(input.workspaceId, input.handoffId, input.newVersionId, input.beforeFrameId, input.afterFrameId)) as Array<{
        baselineVersionId: string;
        beforeFrameId: string;
        afterFrameId: string;
      }>;

    if (existing.some((match) =>
      match.baselineVersionId === input.baselineVersionId &&
      match.beforeFrameId === input.beforeFrameId &&
      match.afterFrameId === input.afterFrameId,
    )) return "already-confirmed" as const;
    if (existing.length) throw new FrameReplacementConflictError();

    (await database
      .prepare(
        `INSERT INTO handoff_frame_replacement
          (handoff_id, workspace_id, baseline_version_id, new_version_id,
           before_frame_id, after_frame_id, confirmed_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.handoffId,
        input.workspaceId,
        input.baselineVersionId,
        input.newVersionId,
        input.beforeFrameId,
        input.afterFrameId,
        input.confirmedByUserId,
        new Date().toISOString(),
      ));
    return "created" as const;
  });

  return confirmMatch();
}

export async function getConfirmedFrameMatchesBetweenVersions(input: {
  workspaceId: string;
  handoffId: string;
  from: { id: string; snapshot: FrameIdentitySnapshot };
  to: { id: string; snapshot: FrameIdentitySnapshot };
}) {
  const database = getDatabase();
  const versions = (await database
    .prepare(
      `SELECT id FROM handoff_version
       WHERE workspace_id = ? AND handoff_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(input.workspaceId, input.handoffId)) as Array<{ id: string }>;
  const replacements = (await database
    .prepare(
      `SELECT baseline_version_id AS baselineVersionId, new_version_id AS newVersionId,
              before_frame_id AS beforeFrameId, after_frame_id AS afterFrameId
       FROM handoff_frame_replacement
       WHERE workspace_id = ? AND handoff_id = ?`,
    )
    .all(input.workspaceId, input.handoffId)) as ConfirmedFrameReplacement[];

  return resolveFrameReplacementMatches({
    versionIds: versions.map((version) => version.id),
    fromVersionId: input.from.id,
    toVersionId: input.to.id,
    fromFrameIds: input.from.snapshot.frames.map((frame) => frame.sourceFrameId),
    toFrameIds: input.to.snapshot.frames.map((frame) => frame.sourceFrameId),
    fromSourceFileId: input.from.snapshot.sourceFileId,
    toSourceFileId: input.to.snapshot.sourceFileId,
    replacements,
  });
}

export class NodeReplacementConflictError extends Error {
  constructor() {
    super("This layer is already matched to another layer in that version.");
    this.name = "NodeReplacementConflictError";
  }
}

type NodeReplacementMatchInput = ConfirmedNodeReplacement & {
  workspaceId: string;
  handoffId: string;
  confirmedByUserId: string;
};

export async function hasConfirmedNodeReplacementMatch(input: Omit<NodeReplacementMatchInput, "confirmedByUserId">) {
  return Boolean((await getDatabase()
    .prepare(
      `SELECT 1 FROM handoff_node_replacement
       WHERE workspace_id = ? AND handoff_id = ?
         AND baseline_version_id = ? AND new_version_id = ?
         AND before_frame_id = ? AND after_frame_id = ?
         AND before_node_id = ? AND after_node_id = ?`,
    )
    .get(
      input.workspaceId,
      input.handoffId,
      input.baselineVersionId,
      input.newVersionId,
      input.beforeFrameId,
      input.afterFrameId,
      input.beforeNodeId,
      input.afterNodeId,
    )));
}

export async function createConfirmedNodeReplacementMatch(input: NodeReplacementMatchInput) {
  const database = getDatabase();
  const confirmMatch = database.transaction(async () => {
    const versions = (await database
      .prepare(
        `SELECT id FROM handoff_version
         WHERE workspace_id = ? AND handoff_id = ? AND id IN (?, ?)
         ORDER BY created_at ASC, id ASC`,
      )
      .all(input.workspaceId, input.handoffId, input.baselineVersionId, input.newVersionId)) as Array<{ id: string }>;
    if (versions.length !== 2 || versions[0].id !== input.baselineVersionId) {
      throw new Error("Choose two versions in the same handoff, with the earlier version as the baseline.");
    }

    const existing = (await database
      .prepare(
        `SELECT before_frame_id AS beforeFrameId, after_frame_id AS afterFrameId,
                before_node_id AS beforeNodeId, after_node_id AS afterNodeId
         FROM handoff_node_replacement
         WHERE workspace_id = ? AND handoff_id = ?
           AND baseline_version_id = ? AND new_version_id = ?
           AND ((before_frame_id = ? AND before_node_id = ?)
             OR (after_frame_id = ? AND after_node_id = ?))`,
      )
      .all(
        input.workspaceId,
        input.handoffId,
        input.baselineVersionId,
        input.newVersionId,
        input.beforeFrameId,
        input.beforeNodeId,
        input.afterFrameId,
        input.afterNodeId,
      )) as Array<Pick<ConfirmedNodeReplacement, "beforeFrameId" | "afterFrameId" | "beforeNodeId" | "afterNodeId">>;

    if (existing.some((match) =>
      match.beforeFrameId === input.beforeFrameId &&
      match.afterFrameId === input.afterFrameId &&
      match.beforeNodeId === input.beforeNodeId &&
      match.afterNodeId === input.afterNodeId,
    )) return "already-confirmed" as const;
    if (existing.length) throw new NodeReplacementConflictError();

    (await database
      .prepare(
        `INSERT INTO handoff_node_replacement
          (handoff_id, workspace_id, baseline_version_id, new_version_id,
           before_frame_id, after_frame_id, before_node_id, after_node_id,
           confirmed_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.handoffId,
        input.workspaceId,
        input.baselineVersionId,
        input.newVersionId,
        input.beforeFrameId,
        input.afterFrameId,
        input.beforeNodeId,
        input.afterNodeId,
        input.confirmedByUserId,
        new Date().toISOString(),
      ));
    return "created" as const;
  });

  return confirmMatch();
}

export async function getConfirmedNodeMatchesBetweenVersions(input: {
  workspaceId: string;
  handoffId: string;
  from: { id: string };
  to: { id: string };
}): Promise<NodeMatch[]> {
  const database = getDatabase();
  const versions = (await database
    .prepare(
      `SELECT id FROM handoff_version
       WHERE workspace_id = ? AND handoff_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(input.workspaceId, input.handoffId)) as Array<{ id: string }>;
  const replacements = (await database
    .prepare(
      `SELECT baseline_version_id AS baselineVersionId, new_version_id AS newVersionId,
              before_frame_id AS beforeFrameId, after_frame_id AS afterFrameId,
              before_node_id AS beforeNodeId, after_node_id AS afterNodeId
       FROM handoff_node_replacement
       WHERE workspace_id = ? AND handoff_id = ?`,
    )
    .all(input.workspaceId, input.handoffId)) as ConfirmedNodeReplacement[];

  return resolveNodeReplacementMatches({
    versionIds: versions.map((version) => version.id),
    fromVersionId: input.from.id,
    toVersionId: input.to.id,
    replacements,
  });
}

// Versions are immutable (enforced by a trigger), so a parsed snapshot can be reused across
// requests. Parsing a large capture takes seconds, but a parsed 250 MB capture also holds ~1 GB, and
// a Vercel Function has 2-4 GB in all. So the cache keeps at most two captures and at most
// ASBIR_SNAPSHOT_CACHE_MB of their stored size (default 160 MB on Vercel, 1 GB on a long-running
// server); a larger capture is used once and not kept, so one big version can't exhaust memory.
const parsedSnapshotCache = new WeakMap<object, Map<string, { snapshot: Promise<StoredSnapshot>; bytes: number }>>();
const parsedSnapshotCacheSize = 2;

function snapshotCacheBudgetBytes() {
  const megabytes = Number(process.env.ASBIR_SNAPSHOT_CACHE_MB);
  const fallback = process.env.VERCEL ? 160 : 1024;
  return (process.env.ASBIR_SNAPSHOT_CACHE_MB && Number.isFinite(megabytes) && megabytes >= 0 ? megabytes : fallback) * 1024 * 1024;
}

async function cachedSnapshot(database: object, key: string, load: () => Promise<{ snapshot: StoredSnapshot; bytes: number }>) {
  let cache = parsedSnapshotCache.get(database);
  if (!cache) {
    cache = new Map();
    parsedSnapshotCache.set(database, cache);
  }
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.snapshot;
  }
  const loaded = Promise.resolve().then(load);
  // Concurrent requests for the same version share one parse while it runs.
  const entry = { snapshot: loaded.then((value) => value.snapshot), bytes: 0 };
  cache.set(key, entry);
  try {
    const { snapshot, bytes } = await loaded;
    entry.bytes = bytes;
    const budget = snapshotCacheBudgetBytes();
    if (bytes > budget) {
      if (cache.get(key) === entry) cache.delete(key);
    } else {
      let total = [...cache.values()].reduce((sum, value) => sum + value.bytes, 0);
      for (const [otherKey, value] of cache) {
        if (cache.size <= parsedSnapshotCacheSize && total <= budget) break;
        if (otherKey === key) continue;
        cache.delete(otherKey);
        total -= value.bytes;
      }
    }
    return snapshot;
  } catch (error) {
    if (cache.get(key) === entry) cache.delete(key);
    throw error;
  }
}

/**
 * Reads a stored capture. Captures were fully validated (and fingerprinted) when saved and never
 * change, and validation adds no defaults or conversions, so a full re-validation here would only
 * build a second deep copy of a large capture (~2x memory). A cheap shape check guards against a
 * damaged row; anything unexpected falls back to full validation.
 */
export function parseStoredSnapshot(snapshotJson: string): StoredSnapshot {
  const value = JSON.parse(snapshotJson) as StoredSnapshot & { frames?: unknown; assets?: unknown; contentHash?: unknown };
  const looksValid =
    value !== null &&
    typeof value === "object" &&
    Array.isArray(value.frames) &&
    Array.isArray(value.assets) &&
    typeof value.contentHash === "string";
  if (looksValid) return value;
  return ("visualOnly" in value && value.visualOnly ? visualOnlySnapshotSchema : snapshotEnvelopeSchema).parse(value);
}

/** Size of a version's snapshot JSON in bytes (uncompressed), without loading or parsing it. */
export async function getVersionSnapshotSize(input: { workspaceId: string; versionId: string }) {
  const row = (await getDatabase()
    .prepare(
      `SELECT COALESCE(handoff_version_snapshot.raw_bytes, octet_length(handoff_version.snapshot_json)) AS sizeBytes
       FROM handoff_version
       LEFT JOIN handoff_version_snapshot ON handoff_version_snapshot.version_id = handoff_version.id
       WHERE handoff_version.id = ? AND handoff_version.workspace_id = ?`,
    )
    .get(input.versionId, input.workspaceId)) as { sizeBytes: number } | undefined;
  return row?.sizeBytes ?? 0;
}

type VersionRow = {
  id: string;
  workspaceId: string;
  handoffId: string;
  versionLabel: string;
  releaseNote: string | null;
  source: string;
  sourceFileId: string;
  sourceRevisionId: string | null;
  capturedAt: string;
  contentHash: string;
  visualOnly: boolean;
  createdBy: string;
  createdAt: string;
};
export type VersionRecord = VersionRow & { assets: StoredVersionAsset[] };
export type VersionWithSnapshot = VersionRecord & { snapshot: StoredSnapshot };

/**
 * A version's row and assets without its capture. Loading a large capture costs about a second of
 * CPU and hundreds of MB on a fresh server, so callers that only check a version exists, is visible,
 * or owns an asset should use this instead of getVersion.
 */
export function getVersionRecord(input: { workspaceId: string; versionId: string }) {
  return getVersion({ ...input, includeSnapshot: false });
}

export async function getVersion(input: { workspaceId: string; versionId: string; includeSnapshot: false }): Promise<VersionRecord | null>;
export async function getVersion(input: { workspaceId: string; versionId: string; includeSnapshot?: true }): Promise<VersionWithSnapshot | null>;
export async function getVersion(input: { workspaceId: string; versionId: string; includeSnapshot?: boolean }): Promise<VersionRecord | VersionWithSnapshot | null> {
  const database = getDatabase();
  const row = (await database
    .prepare(
      `SELECT id, workspace_id AS workspaceId, handoff_id AS handoffId,
              version_label AS versionLabel, release_note AS releaseNote,
              source, source_file_id AS sourceFileId,
              source_revision_id AS sourceRevisionId, captured_at AS capturedAt,
              content_hash AS contentHash, visual_only AS visualOnly,
              created_by_user_id AS createdBy,
              created_at AS createdAt
       FROM handoff_version WHERE id = ? AND workspace_id = ?`,
    )
    .get(input.versionId, input.workspaceId)) as
    | VersionRow
    | undefined;

  if (!row) return null;

  const assets = (await getDatabase()
    .prepare(
      `SELECT id, asset_key AS assetKey, object_key AS objectKey,
              file_name AS fileName, content_type AS contentType,
              size_bytes AS sizeBytes, sha256, width, height
       FROM handoff_asset WHERE handoff_version_id = ? AND workspace_id = ?
       ORDER BY asset_key`,
    )
    .all(input.versionId, input.workspaceId)) as StoredVersionAsset[];

  if (input.includeSnapshot === false) return { ...row, assets };

  const snapshot = await cachedSnapshot(database, `${row.id}:${row.contentHash}`, async () => {
    const snapshotJson = (await readSnapshotJson(database, input.versionId, input.workspaceId)) ?? "{}";
    return { snapshot: parseStoredSnapshot(snapshotJson), bytes: snapshotJson.length };
  });

  return { ...row, snapshot, assets };
}

export function deleteHandoffVersion(input: {
  workspaceId: string;
  projectId: string;
  handoffId: string;
  versionId: string;
}) {
  return deleteHandoffVersionInDatabase(getDatabase(), input);
}

export async function getAssetByObjectKey(objectKey: string) {
  return (await getDatabase()
    .prepare(
      `SELECT handoff_asset.id, handoff_asset.workspace_id AS workspaceId,
              handoff_asset.handoff_version_id AS versionId,
              handoff_asset.object_key AS objectKey,
              handoff_asset.file_name AS fileName,
              handoff_asset.content_type AS contentType,
              handoff_asset.size_bytes AS sizeBytes,
              handoff_asset.sha256
       FROM handoff_asset
       WHERE handoff_asset.object_key = ?`,
    )
    .get(objectKey)) as
    | {
        id: string;
        workspaceId: string;
        versionId: string;
        objectKey: string;
        fileName: string;
        contentType: string;
        sizeBytes: number;
        sha256: string;
      }
    | undefined;
}
