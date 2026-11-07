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

export type VersionAssetInput = SnapshotAsset & {
  bytes: Uint8Array;
};

export type CreateHandoffVersionInput = {
  workspaceId: string;
  projectId: string;
  handoffId?: string;
  handoffName?: string;
  versionLabel: string;
  releaseNote?: string | null;
  createdBy: string;
  snapshot: StoredSnapshot;
  assets: VersionAssetInput[];
  consumeCaptureSessionId?: string;
  frameReplacementMatches?: {
    baselineVersionId: string;
    matches: Array<{ beforeFrameId: string; afterFrameId: string }>;
  };
};

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
    if (asset.sizeBytes !== uploaded.bytes.byteLength || asset.sizeBytes !== uploaded.sizeBytes) {
      throw new Error(`Asset size does not match for "${asset.key}".`);
    }
    const digest = bytesSha256(uploaded.bytes);
    if (asset.sha256 !== digest || uploaded.sha256 !== digest) {
      throw new Error(`Asset checksum does not match for "${asset.key}".`);
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
  const storedAssets = input.assets.map((asset) => ({
    asset,
    id: randomUUID(),
    objectKey: randomBytes(24).toString("hex"),
  }));
  const writtenObjectKeys: string[] = [];

  try {
    for (const { asset, objectKey } of storedAssets) {
      await objectStore.put(objectKey, asset.bytes, asset.contentType);
      writtenObjectKeys.push(objectKey);
    }

    const insertVersion = database.transaction(() => {
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

    insertVersion();
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
  const fromIndex = versions.findIndex((version) => version.id === input.from.id);
  const toIndex = versions.findIndex((version) => version.id === input.to.id);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return [];

  const replacements = database
    .prepare(
      `SELECT baseline_version_id AS baselineVersionId, new_version_id AS newVersionId,
              before_frame_id AS beforeFrameId, after_frame_id AS afterFrameId
       FROM handoff_frame_replacement
       WHERE workspace_id = ? AND handoff_id = ?`,
    )
    .all(input.workspaceId, input.handoffId) as Array<{
      baselineVersionId: string;
      newVersionId: string;
      beforeFrameId: string;
      afterFrameId: string;
    }>;
  const currentFrameIds = new Map(input.from.snapshot.frames.map((frame) => [frame.sourceFrameId, frame.sourceFrameId]));

  if (fromIndex < toIndex) {
    for (let index = fromIndex + 1; index <= toIndex; index += 1) {
      const baselineVersionId = versions[index - 1].id;
      const newVersionId = versions[index].id;
      for (const replacement of replacements) {
        if (replacement.baselineVersionId !== baselineVersionId || replacement.newVersionId !== newVersionId) continue;
        for (const [originalId, currentId] of currentFrameIds) {
          if (currentId === replacement.beforeFrameId) currentFrameIds.set(originalId, replacement.afterFrameId);
        }
      }
    }
  } else {
    for (let index = fromIndex; index > toIndex; index -= 1) {
      const baselineVersionId = versions[index - 1].id;
      const newVersionId = versions[index].id;
      for (const replacement of replacements) {
        if (replacement.baselineVersionId !== baselineVersionId || replacement.newVersionId !== newVersionId) continue;
        for (const [originalId, currentId] of currentFrameIds) {
          if (currentId === replacement.afterFrameId) currentFrameIds.set(originalId, replacement.beforeFrameId);
        }
      }
    }
  }

  const targetFrameIds = new Set(input.to.snapshot.frames.map((frame) => frame.sourceFrameId));
  return [...currentFrameIds].flatMap(([beforeFrameId, afterFrameId]) =>
    (afterFrameId !== beforeFrameId || input.from.snapshot.sourceFileId !== input.to.snapshot.sourceFileId) && targetFrameIds.has(afterFrameId)
      ? [{ beforeFrameId, afterFrameId }]
      : [],
  );
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
