import { after } from "next/server";
import { primeCanvasCopy } from "@/src/server/services/version-canvas";
import { storeScreenCopiesLater } from "@/src/server/services/frame-store";
import { notifyNewVersion } from "@/src/server/services/slack";
import { z } from "zod";
import { createSnapshotEnvelope, removeFramesFromSnapshot, type SnapshotEnvelope } from "@asbir/snapshot-contract";
import { getHandoff, listHandoffVersions } from "@/src/server/repositories/handoffs";
import { createHandoffVersion, getVersion, HandoffVersionConflictError, type VersionAssetInput } from "@/src/server/repositories/versions";
import { requireHandoffAccess, WorkspaceAccessError } from "@/src/server/workspace-access";

/**
 * Large captures (250 MB of JSON) take tens of seconds to verify, merge and store. 300 s is the
 * highest limit every Vercel plan accepts; on Pro it can be raised to 800 here.
 */
export const maxDuration = 300;

type RemoveScreensRoute = {
  params: Promise<{ workspaceId: string; projectId: string; handoffId: string }>;
};

const bodySchema = z.object({
  baseVersionId: z.string().uuid(),
  frameIds: z.array(z.string().trim().min(1).max(256)).min(1).max(1000),
  versionLabel: z.string().trim().max(80).optional(),
  releaseNote: z.string().trim().max(2000).optional(),
});

function defaultReleaseNote(names: string[]) {
  const listed = names.slice(0, 8).join(", ");
  const more = names.length > 8 ? ` and ${names.length - 8} more` : "";
  return `Removed ${names.length === 1 ? "1 screen" : `${names.length} screens`} that no longer apply: ${listed}${more}.`;
}

/**
 * Creates a new version that is the latest one minus the chosen screens. Versions never change,
 * so removal is recorded as a new version; comparisons then report those screens as removed.
 */
export async function POST(request: Request, context: RemoveScreensRoute) {
  const { workspaceId, projectId, handoffId } = await context.params;
  try {
    const actor = await requireHandoffAccess(request, { workspaceId, handoffId, manage: true });
    const handoff = (await getHandoff({ workspaceId, projectId, handoffId }));
    if (!handoff) return Response.json({ error: "Handoff not found." }, { status: 404 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Choose at least one screen to remove." }, { status: 400 });
    const { baseVersionId, frameIds, versionLabel, releaseNote } = parsed.data;

    const latest = ((await listHandoffVersions({ workspaceId, handoffId })) as Array<{ id: string; versionLabel: string }>)[0];
    if (!latest || latest.id !== baseVersionId) {
      return Response.json({ error: "A newer version exists. Open the latest version and try again." }, { status: 409 });
    }
    const base = (await getVersion({ workspaceId, versionId: baseVersionId }));
    if (!base || base.handoffId !== handoffId) return Response.json({ error: "Version not found." }, { status: 404 });
    if (base.visualOnly) {
      return Response.json({ error: "Screens can only be removed from Figma captures." }, { status: 400 });
    }

    let result: ReturnType<typeof removeFramesFromSnapshot>;
    try {
      result = removeFramesFromSnapshot(base.snapshot as SnapshotEnvelope, [...new Set(frameIds)]);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "These screens can't be removed." }, { status: 400 });
    }
    const finalized = await createSnapshotEnvelope(result.snapshot);
    if (!finalized.success) return Response.json({ error: "The updated snapshot is not valid." }, { status: 400 });

    const storedByKey = new Map(base.assets.map((asset) => [asset.assetKey, asset] as const));
    const assets: VersionAssetInput[] = finalized.data.assets.map((asset) => {
      const stored = storedByKey.get(asset.key);
      if (!stored) throw new Error(`The image "${asset.fileName}" could not be reused.`);
      return { ...asset, reuseObjectKey: stored.objectKey };
    });

    const removedNames = result.removed.map((frame) => frame.name);
    const created = await createHandoffVersion({
      workspaceId,
      projectId,
      handoffId,
      expectedLatestVersionId: baseVersionId,
      versionLabel: versionLabel || `${latest.versionLabel} · ${removedNames.length === 1 ? "1 screen" : `${removedNames.length} screens`} removed`,
      releaseNote: releaseNote || defaultReleaseNote(removedNames),
      createdBy: actor.userId,
      snapshot: finalized.data,
      // createSnapshotEnvelope validated it and computed its hash.
      snapshotVerified: true,
      assets,
      reuseAssetsFromVersionId: baseVersionId,
    });
    await primeCanvasCopy(created.versionId, finalized.data.contentHash, finalized.data);
    storeScreenCopiesLater(workspaceId, created.versionId, finalized.data);
    after(() => notifyNewVersion({ workspaceId, handoffId: created.handoffId, versionId: created.versionId, createdBy: actor.userId }).catch((error) => console.warn("[slack]", error)));
    return Response.json({ versionId: created.versionId, removed: removedNames }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof HandoffVersionConflictError) {
      return Response.json({ error: "A newer version exists. Open the latest version and try again." }, { status: 409 });
    }
    throw error;
  }
}
