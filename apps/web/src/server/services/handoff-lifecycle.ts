import type { PostgresDatabase } from "../db";

export type HandoffLifecycleDatabase = PostgresDatabase;

export async function assertReusableAssetReferences(
  database: HandoffLifecycleDatabase,
  input: { workspaceId: string; handoffId: string; sourceVersionId: string; objectKeys: string[] },
) {
  const sourceVersion = (await database
    .prepare(
      `SELECT id FROM handoff_version
       WHERE id = ? AND workspace_id = ? AND handoff_id = ?`,
    )
    .get(input.sourceVersionId, input.workspaceId, input.handoffId));
  if (!sourceVersion) {
    throw new Error("Reusable asset source version is no longer available.");
  }

  const findAsset = database.prepare(
    `SELECT 1 FROM handoff_asset
     WHERE workspace_id = ? AND handoff_version_id = ? AND object_key = ? LIMIT 1`,
  );
  const matchingAssets = await Promise.all(input.objectKeys.map((objectKey) =>
    findAsset.get(input.workspaceId, input.sourceVersionId, objectKey),
  ));
  if (matchingAssets.some((asset) => !asset)) {
    throw new Error("Reusable asset is no longer attached to its source version.");
  }
}

export async function deleteHandoffInDatabase(
  database: HandoffLifecycleDatabase,
  input: { workspaceId: string; projectId: string; handoffId: string },
) {
  const remove = database.transaction(async () => {
    const handoff = (await database
      .prepare(
        `SELECT id FROM handoff
         WHERE id = ? AND workspace_id = ? AND project_id = ?
         FOR UPDATE`,
      )
      .get(input.handoffId, input.workspaceId, input.projectId));
    if (!handoff) return null;

    const objectKeys = (await database
      .prepare(
        `SELECT DISTINCT handoff_asset.object_key AS objectKey
         FROM handoff_asset
         JOIN handoff_version ON handoff_version.id = handoff_asset.handoff_version_id
           AND handoff_version.workspace_id = handoff_asset.workspace_id
         WHERE handoff_version.handoff_id = ? AND handoff_version.workspace_id = ?`,
      )
      .all(input.handoffId, input.workspaceId)) as Array<{ objectKey: string }>;

    (await database
      .prepare("DELETE FROM handoff WHERE id = ? AND workspace_id = ? AND project_id = ?")
      .run(input.handoffId, input.workspaceId, input.projectId));

    const uniqueObjectKeys = [...new Set(objectKeys.map(({ objectKey }) => objectKey))];
    const references = await Promise.all(uniqueObjectKeys.map((objectKey) =>
      database.prepare("SELECT 1 FROM handoff_asset WHERE object_key = ? LIMIT 1").get(objectKey),
    ));
    const unreferencedObjectKeys = uniqueObjectKeys.filter((_, index) => !references[index]);

    return { handoffId: input.handoffId, unreferencedObjectKeys };
  });

  return remove();
}

export async function deleteHandoffVersionInDatabase(
  database: HandoffLifecycleDatabase,
  input: { workspaceId: string; projectId: string; handoffId: string; versionId: string },
) {
  const remove = database.transaction(async () => {
    // Serialize with publishes that may be reusing this version's assets (see createHandoffVersion).
    (await database
      .prepare("SELECT id FROM handoff WHERE id = ? AND workspace_id = ? FOR UPDATE")
      .get(input.handoffId, input.workspaceId));
    const version = (await database
      .prepare(
        `SELECT handoff_version.id
         FROM handoff_version
         JOIN handoff ON handoff.id = handoff_version.handoff_id
           AND handoff.workspace_id = handoff_version.workspace_id
         WHERE handoff_version.id = ? AND handoff_version.workspace_id = ?
           AND handoff_version.handoff_id = ? AND handoff.project_id = ?`,
      )
      .get(input.versionId, input.workspaceId, input.handoffId, input.projectId));
    if (!version) return null;

    const objectKeys = (await database
      .prepare(
        `SELECT object_key AS objectKey FROM handoff_asset
         WHERE handoff_version_id = ? AND workspace_id = ?`,
      )
      .all(input.versionId, input.workspaceId)) as Array<{ objectKey: string }>;

    (await database
      .prepare("DELETE FROM handoff_version WHERE id = ? AND workspace_id = ? AND handoff_id = ?")
      .run(input.versionId, input.workspaceId, input.handoffId));

    const remainingLatest = (await database
      .prepare(
        `SELECT id FROM handoff_version
         WHERE workspace_id = ? AND handoff_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(input.workspaceId, input.handoffId)) as { id: string } | undefined;
    const uniqueObjectKeys = [...new Set(objectKeys.map(({ objectKey }) => objectKey))];
    const references = await Promise.all(uniqueObjectKeys.map((objectKey) =>
      database.prepare("SELECT 1 FROM handoff_asset WHERE object_key = ? LIMIT 1").get(objectKey),
    ));
    const unreferencedObjectKeys = uniqueObjectKeys.filter((_, index) => !references[index]);

    return {
      deletedVersionId: input.versionId,
      remainingLatestVersionId: remainingLatest?.id ?? null,
      unreferencedObjectKeys,
    };
  });

  return remove();
}
