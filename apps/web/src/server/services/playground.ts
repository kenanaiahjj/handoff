import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createSnapshotEnvelope } from "@asbir/snapshot-contract";
import { getDatabase } from "../db";
import { deleteHandoff, publishHandoffVersion } from "../repositories/handoffs";
import { createHandoffVersion, type VersionAssetInput } from "../repositories/versions";
import { objectStore } from "../storage/supabase-object-store";
import type { HandoffInviteRole } from "./handoff-sharing";

/**
 * The Playground: one shared, read-only sample project ("Penny", a made-up finance app) that every
 * signed-in person can open to try the canvas, Review changes, Compare, Inspect and comments before
 * their own team's designs are in Handoff. It lives in a workspace nobody is a member of, shared as
 * "anyone with the link", which makes it view-only for everyone.
 *
 * Its screens are built from HTML by scripts/playground/build.mjs into apps/web/playground/. The app
 * creates it from those files the first time someone opens it, and rebuilds it when they change.
 */
export const playgroundShareId = "playground";
const workspaceId = "asbir-playground";
const projectId = "asbir-playground-project";
const handoffId = "asbir-playground-penny";
const systemUserId = "asbir-playground";
/** A half-built Playground older than this was abandoned by a crashed request and is rebuilt. */
const staleBuildMs = 3 * 60_000;

type Manifest = {
  versions: Array<{ label: string; note: string; file: string }>;
  comments: Array<{
    frame: string;
    layer: string;
    x: number;
    y: number;
    author: string;
    role: HandoffInviteRole;
    hoursAgo: number;
    body: string;
    resolved?: boolean;
    replies?: Array<{ author: string; role: HandoffInviteRole; hoursAgo: number; body: string }>;
  }>;
};

type SnapshotFile = {
  capturedAt: string;
  assets: Array<{ key: string; fileName: string }>;
  frames: Array<{ sourceFrameId: string; nodes: Array<{ sourceNodeId: string; name: string; bounds: { x: { value: number | null }; y: { value: number | null } } }> }>;
};

let bundleDirectory: Promise<string> | null = null;

/** The built files ship next to the app (see outputFileTracingIncludes in next.config.ts). */
function findBundle() {
  bundleDirectory ??= (async () => {
    for (const candidate of ["playground", "apps/web/playground"]) {
      const directory = path.resolve(process.cwd(), candidate);
      try {
        await readFile(path.join(directory, "manifest.json"));
        return directory;
      } catch {
        // Started from another folder: try the next place.
      }
    }
    bundleDirectory = null;
    throw new Error("The Playground files are missing from this build.");
  })();
  return bundleDirectory;
}

async function readBundle() {
  const directory = await findBundle();
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as Manifest;
  const versions = await Promise.all(manifest.versions.map(async (version) => {
    const text = await readFile(path.join(directory, version.file), "utf8");
    return { ...version, text, raw: JSON.parse(text) as SnapshotFile };
  }));
  // One fingerprint for the whole bundle: when it changes, the Playground is rebuilt.
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(manifest))
    .update(versions.map((version) => version.text).join("\n"))
    .digest("hex")
    .slice(0, 24);
  return { directory, manifest, versions, fingerprint };
}

async function build(bundle: Awaited<ReturnType<typeof readBundle>>) {
  const database = getDatabase();
  const now = new Date().toISOString();

  await database.prepare(
    `INSERT INTO "user" (id, name, email, "emailVerified") VALUES (?, ?, ?, TRUE) ON CONFLICT (id) DO NOTHING`,
  ).run(systemUserId, "Handoff Playground", "playground@asbir.invalid");
  await database.prepare(
    "INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
  ).run(workspaceId, "Handoff Playground", systemUserId, now);
  await database.prepare(
    "INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
  ).run(projectId, workspaceId, "Playground", systemUserId, now);

  // Claim the build: only the request that creates the handoff row goes on to add its versions.
  const claimed = await database.prepare(
    `INSERT INTO handoff (id, workspace_id, project_id, name, created_by_user_id, created_at, sharing_mode)
     VALUES (?, ?, ?, ?, ?, ?, 'anyone') ON CONFLICT (id) DO NOTHING`,
  ).run(handoffId, workspaceId, projectId, "Penny app", systemUserId, now);
  if (claimed.changes !== 1) return false;

  let latestVersionId = "";
  for (const version of bundle.versions) {
    // The bundle's fingerprint rides along as the source revision, so a later build can tell whether
    // the stored Playground matches its files.
    const envelope = await createSnapshotEnvelope({ ...JSON.parse(version.text), sourceRevisionId: bundle.fingerprint });
    if (!envelope.success) throw new Error(`Playground snapshot ${version.label} is not valid.`);
    const assets: VersionAssetInput[] = await Promise.all(envelope.data.assets.map(async (asset) => {
      const bytes = new Uint8Array(await readFile(path.join(bundle.directory, "assets", asset.fileName)));
      return { ...asset, bytes };
    }));
    const { versionId } = await createHandoffVersion({
      workspaceId,
      projectId,
      handoffId,
      versionLabel: version.label,
      releaseNote: version.note,
      createdBy: systemUserId,
      snapshot: envelope.data,
      assets,
      snapshotVerified: true,
    });
    latestVersionId = versionId;
  }

  // Sample comments on the latest version, pinned to their layer.
  const latest = bundle.versions.at(-1)!;
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  for (const comment of bundle.manifest.comments) {
    const frame = latest.raw.frames.find((entry) => entry.sourceFrameId === comment.frame);
    const node = frame?.nodes.find((entry) => entry.name === comment.layer);
    if (!frame || !node) continue;
    const id = randomUUID();
    const insert = (values: { id: string; parent: string | null; author: string; role: HandoffInviteRole; body: string; at: string; x: number | null; y: number | null; node: string | null; resolvedAt: string | null }) =>
      database.prepare(
        `INSERT INTO handoff_comment
          (id, workspace_id, handoff_version_id, frame_id, source_node_id, x, y, parent_comment_id, body,
           resolved_at, created_by_user_id, author_label, author_role, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      ).run(values.id, workspaceId, latestVersionId, frame.sourceFrameId, values.node, values.x, values.y, values.parent, values.body,
        values.resolvedAt, values.author, values.role, values.at);
    await insert({
      id, parent: null, author: comment.author, role: comment.role, body: comment.body, at: hoursAgo(comment.hoursAgo),
      x: (node.bounds.x.value ?? 0) + comment.x, y: (node.bounds.y.value ?? 0) + comment.y, node: node.sourceNodeId,
      resolvedAt: comment.resolved ? hoursAgo(Math.max(0, comment.hoursAgo - 3)) : null,
    });
    for (const reply of comment.replies ?? []) {
      await insert({ id: randomUUID(), parent: id, author: reply.author, role: reply.role, body: reply.body, at: hoursAgo(reply.hoursAgo), x: null, y: null, node: null, resolvedAt: null });
    }
  }

  await database.prepare("UPDATE handoff SET review_share_id = ? WHERE id = ?").run(playgroundShareId, handoffId);
  await publishHandoffVersion({ workspaceId, projectId, handoffId, versionId: latestVersionId, publishedByUserId: systemUserId });
  return true;
}

let ready: Promise<void> | null = null;

/**
 * Makes sure the Playground exists and matches this build's files. Cheap after the first call in a
 * server instance. Throws "still being set up" while another request is building it.
 */
export function ensurePlayground() {
  // Locally, check every time so a rebuilt bundle shows up without restarting the server.
  if (process.env.NODE_ENV === "development") ready = null;
  ready ??= (async () => {
    const bundle = await readBundle();
    const database = getDatabase();
    const current = (await database.prepare(
      `SELECT handoff.published_version_id AS publishedVersionId, handoff.created_at AS createdAt,
              published.source_revision_id AS revision
       FROM handoff LEFT JOIN handoff_version AS published ON published.id = handoff.published_version_id
       WHERE handoff.id = ?`,
    ).get(handoffId)) as { publishedVersionId: string | null; createdAt: string; revision: string | null } | undefined;

    const upToDate = current?.publishedVersionId && current.revision === bundle.fingerprint;
    if (upToDate) return;
    if (current && !current.publishedVersionId && Date.now() - Date.parse(current.createdAt) < staleBuildMs) {
      throw new PlaygroundBuildingError();
    }
    // Out of date or abandoned: start over.
    if (current) {
      const removed = await deleteHandoff({ workspaceId, projectId, handoffId });
      await Promise.all((removed?.unreferencedObjectKeys ?? []).map((key) => objectStore.delete(key).catch(() => undefined)));
    }
    if (!(await build(bundle))) throw new PlaygroundBuildingError();
  })();
  // A failed or in-progress attempt is retried by the next request.
  ready.catch(() => { ready = null; });
  return ready;
}

export class PlaygroundBuildingError extends Error {
  constructor() {
    super("The Playground is still being set up.");
  }
}
