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
import { objectStore } from "../storage/local-object-store";
import {
  assertReusableAssetReferences,
  deleteHandoffVersionInDatabase,
} from "../services/handoff-lifecycle";
import {
  resolveFrameReplacementMatches,
  type ConfirmedFrameReplacement,
} from "../services/frame-replacements";

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
  | { bytes: Uint8Array; reuseObjectKey?: never }
  | { bytes?: never; reuseObjectKey: string }
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
    } else if (!uploaded.reuseObjectKey || !/^[a-f0-9]{48}$/.test(uploaded.reuseObjectKey)) {
      throw new Error(`Asset bytes are missing for "${asset.key}".`);
    }
  }
}

export async function createHandoffVersion(input: CreateHandoffVersionInput) {
  const snapshot = validateStoredSnapshot(input.snapshot);
  const contentHash = await hashSnapshotPayload(snapshot);
  if (snapshot.contentHash !== contentHash) {
    throw new Error("Snapshot content hash does not match its content.");
  }
  assertAssetBytes(snapshot, input.assets);

  const database = getDatabase();
  const project = database
    .prepare("SELECT 1 FROM project WHERE id = ? AND workspace_id = ?")
    .get(input.projectId, input.workspaceId);
  if (!project) throw new Error("Project not found in this workspace.");

  if (input.handoffId) {
    const handoff = database
      .prepare(
        "SELECT 1 FROM handoff WHERE id = ? AND project_id = ? AND workspace_id = ?",
      )
      .get(input.handoffId, input.projectId, input.workspaceId);
    if (!handoff) throw new Error("Handoff not found in this project.");
  } else if (!input.handoffName?.trim()) {
    throw new Error("A handoff name is required for the first version.");
  }

  const now = new Date().toISOString();
  const newHandoffId = input.handoffId ?? randomUUID();
  const versionId = randomUUID();
  const reusedVersion = input.reuseAssetsFromVersionId
    ? database
        .prepare("SELECT handoff_id AS handoffId FROM handoff_version WHERE id = ? AND workspace_id = ?")
        .get(input.reuseAssetsFromVersionId, input.workspaceId) as { handoffId: string } | undefined
    : undefined;
  if (input.reuseAssetsFromVersionId && reusedVersion?.handoffId !== newHandoffId) {
    throw new Error("Reusable assets must belong to an earlier version in this handoff.");
  }
  const storedAssets = input.assets.map((asset) => {
    if (asset.bytes) {
      return {
        asset,
        id: randomUUID(),
        objectKey: randomBytes(24).toString("hex"),
      };
    }
    if (!input.reuseAssetsFromVersionId) throw new Error("Reusable assets require a baseline handoff version.");
    const source = database
      .prepare(
        `SELECT file_name AS fileName, content_type AS contentType,
                size_bytes AS sizeBytes, sha256, width, height
         FROM handoff_asset
         WHERE workspace_id = ? AND handoff_version_id = ? AND object_key = ?`,
      )
      .get(input.workspaceId, input.reuseAssetsFromVersionId, asset.reuseObjectKey) as
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
  });
  const writtenObjectKeys: string[] = [];

  try {
    for (const { asset, objectKey } of storedAssets) {
      if (!asset.bytes) continue;
      await objectStore.put(objectKey, asset.bytes, asset.contentType);
      writtenObjectKeys.push(objectKey);
    }

    const insertVersion = database.transaction(() => {
      if (input.expectedLatestVersionId) {
        const latest = input.handoffId
          ? database
              .prepare(
                `SELECT id FROM handoff_version
                 WHERE workspace_id = ? AND handoff_id = ?
                 ORDER BY created_at DESC, id DESC LIMIT 1`,
              )
              .get(input.workspaceId, input.handoffId) as { id: string } | undefined
          : undefined;
        if (latest?.id !== input.expectedLatestVersionId) {
          throw new HandoffVersionConflictError();
        }
      }

      if (input.reuseAssetsFromVersionId) {
        assertReusableAssetReferences(database, {
          workspaceId: input.workspaceId,
          handoffId: newHandoffId,
          sourceVersionId: input.reuseAssetsFromVersionId,
          objectKeys: input.assets.flatMap((asset) => asset.bytes ? [] : [asset.reuseObjectKey]),
        });
      }

      if (input.consumeCaptureSessionId) {
        const consumed = database
          .prepare(
            `UPDATE capture_session SET used_at = ?
             WHERE id = ? AND workspace_id = ? AND project_id = ?
               AND (handoff_id IS NULL OR handoff_id = ?)
               AND used_at IS NULL AND expires_at > ?`,
          )
          .run(now, input.consumeCaptureSessionId, input.workspaceId, input.projectId, newHandoffId, now);
        if (consumed.changes !== 1) throw new Error("Capture session expired, was already used, or no longer matches this handoff.");
      }

      if (!input.handoffId) {
        database
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
          );
      }

      database
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
          isVisualOnly(snapshot) ? 1 : 0,
          JSON.stringify(snapshot),
          input.createdBy,
          now,
        );

      const insertAsset = database.prepare(
        `INSERT INTO handoff_asset
          (id, workspace_id, handoff_version_id, asset_key, object_key, file_name,
           content_type, size_bytes, sha256, width, height, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      for (const { asset, id, objectKey } of storedAssets) {
        insertAsset.run(
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
        const baseline = database
          .prepare("SELECT id FROM handoff_version WHERE id = ? AND handoff_id = ? AND workspace_id = ?")
          .get(input.frameReplacementMatches.baselineVersionId, newHandoffId, input.workspaceId);
        if (!baseline) throw new Error("The confirmed replacement baseline is no longer in this handoff.");

        const insertReplacement = database.prepare(
          `INSERT INTO handoff_frame_replacement
            (handoff_id, workspace_id, baseline_version_id, new_version_id,
             before_frame_id, after_frame_id, confirmed_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const match of input.frameReplacementMatches.matches) {
          insertReplacement.run(
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
    });

    insertVersion.immediate();
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

export function hasConfirmedFrameReplacementMatch(input: Omit<FrameReplacementMatchInput, "confirmedByUserId">) {
  return Boolean(getDatabase()
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
    ));
}

export function createConfirmedFrameReplacementMatch(input: FrameReplacementMatchInput) {
  const database = getDatabase();
  const confirmMatch = database.transaction(() => {
    const versions = database
      .prepare(
        `SELECT id FROM handoff_version
         WHERE workspace_id = ? AND handoff_id = ? AND id IN (?, ?)
         ORDER BY created_at ASC, id ASC`,
      )
      .all(input.workspaceId, input.handoffId, input.baselineVersionId, input.newVersionId) as Array<{ id: string }>;
    if (versions.length !== 2 || versions[0].id !== input.baselineVersionId) {
      throw new Error("Choose two versions in the same handoff, with the earlier version as the baseline.");
    }

    const existing = database
      .prepare(
        `SELECT baseline_version_id AS baselineVersionId, before_frame_id AS beforeFrameId,
                after_frame_id AS afterFrameId
         FROM handoff_frame_replacement
         WHERE workspace_id = ? AND handoff_id = ? AND new_version_id = ?
           AND (before_frame_id = ? OR after_frame_id = ?)`,
      )
      .all(input.workspaceId, input.handoffId, input.newVersionId, input.beforeFrameId, input.afterFrameId) as Array<{
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

    database
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
      );
    return "created" as const;
  });

  return confirmMatch.immediate();
}

export function getConfirmedFrameMatchesBetweenVersions(input: {
  workspaceId: string;
  handoffId: string;
  from: { id: string; snapshot: FrameIdentitySnapshot };
  to: { id: string; snapshot: FrameIdentitySnapshot };
}) {
  const database = getDatabase();
  const versions = database
    .prepare(
      `SELECT id FROM handoff_version
       WHERE workspace_id = ? AND handoff_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(input.workspaceId, input.handoffId) as Array<{ id: string }>;
  const replacements = database
    .prepare(
      `SELECT baseline_version_id AS baselineVersionId, new_version_id AS newVersionId,
              before_frame_id AS beforeFrameId, after_frame_id AS afterFrameId
       FROM handoff_frame_replacement
       WHERE workspace_id = ? AND handoff_id = ?`,
    )
    .all(input.workspaceId, input.handoffId) as ConfirmedFrameReplacement[];

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

export function getVersion(input: { workspaceId: string; versionId: string }) {
  const row = getDatabase()
    .prepare(
      `SELECT id, workspace_id AS workspaceId, handoff_id AS handoffId,
              version_label AS versionLabel, release_note AS releaseNote,
              source, source_file_id AS sourceFileId,
              source_revision_id AS sourceRevisionId, captured_at AS capturedAt,
              content_hash AS contentHash, visual_only AS visualOnly,
              snapshot_json AS snapshotJson, created_by_user_id AS createdBy,
              created_at AS createdAt
       FROM handoff_version WHERE id = ? AND workspace_id = ?`,
    )
    .get(input.versionId, input.workspaceId) as
    | {
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
        visualOnly: number;
        snapshotJson: string;
        createdBy: string;
        createdAt: string;
      }
    | undefined;

  if (!row) return null;

  const assets = getDatabase()
    .prepare(
      `SELECT id, asset_key AS assetKey, object_key AS objectKey,
              file_name AS fileName, content_type AS contentType,
              size_bytes AS sizeBytes, sha256, width, height
       FROM handoff_asset WHERE handoff_version_id = ? AND workspace_id = ?
       ORDER BY asset_key`,
    )
    .all(input.versionId, input.workspaceId) as StoredVersionAsset[];

  const snapshotValue = JSON.parse(row.snapshotJson) as StoredSnapshot;
  const snapshot = ("visualOnly" in snapshotValue && snapshotValue.visualOnly
    ? visualOnlySnapshotSchema
    : snapshotEnvelopeSchema
  ).parse(snapshotValue);

  return { ...row, visualOnly: row.visualOnly === 1, snapshot, assets };
}

export function deleteHandoffVersion(input: {
  workspaceId: string;
  projectId: string;
  handoffId: string;
  versionId: string;
}) {
  return deleteHandoffVersionInDatabase(getDatabase(), input);
}

export function getAssetByObjectKey(objectKey: string) {
  return getDatabase()
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
    .get(objectKey) as
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
