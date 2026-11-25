// Dev-only: creates a "Review changes (sample)" project with one handoff whose second version
// removes a screen, adds one, and edits elements on two others, so the Changes highlights, the
// changes list and compare all have something to show locally. Built from an existing Figma capture
// (same images), so the edited screens look the same in pictures; the edits are in the layer data.
//
// Run from the repo root:
//   node --experimental-transform-types --loader ./scripts/node-esm-loader.mjs scripts/seed-review-changes.mjs
//
// Rerunning replaces the sample project.
import { randomUUID } from "node:crypto";
import path from "node:path";

process.chdir(path.resolve("apps/web"));
const { getDatabase } = await import("@/src/server/db.ts");
const { createSnapshotEnvelope, removeFramesFromSnapshot } = await import("@asbir/snapshot-contract");
const { readSnapshotJson, storeCompressedSnapshot } = await import("@/src/server/storage/snapshot-store.ts");

const PROJECT = "Review changes (sample)";
const SCREEN_COUNT = 6;
const database = getDatabase();
const HOUR = 3_600_000;
const isoHoursAgo = (hours) => new Date(Date.now() - hours * HOUR).toISOString();

const owner = (await database.query(`SELECT "user".id FROM workspace_membership JOIN "user" ON "user".id = workspace_membership.user_id
            WHERE workspace_membership.role = 'owner' ORDER BY workspace_membership.created_at ASC LIMIT 1`)).rows[0];
if (!owner) throw new Error("No workspace owner found. Sign in and create a workspace first.");
const company = (await database.query("SELECT id FROM workspace ORDER BY created_at ASC, id ASC LIMIT 1")).rows[0];
if (!company) throw new Error("No workspace yet. Sign in once to set it up.");

let base = (await database.query(
  `SELECT handoff_version.* FROM handoff_version
   LEFT JOIN handoff_version_snapshot ON handoff_version_snapshot.version_id = handoff_version.id
   WHERE visual_only IS FALSE AND source = 'figma'
   ORDER BY COALESCE(handoff_version_snapshot.raw_bytes, length(handoff_version.snapshot_json)) DESC LIMIT 1`,
)).rows[0];
let baseSnapshot;
let baseAssets;
if (base) {
  baseSnapshot = JSON.parse(await readSnapshotJson(database, base.id, base.workspace_id));
  baseAssets = new Map(
    (await database.query("SELECT * FROM handoff_asset WHERE handoff_version_id = $1", [base.id])).rows
      .map((asset) => [asset.asset_key, asset]),
  );
} else {
  // No capture in the local PostgreSQL yet: borrow the largest old SQLite capture whose images are
  // all still in data/objects (the local object store reads the same folder).
  const { DatabaseSync } = await import("node:sqlite");
  const { existsSync } = await import("node:fs");
  const { brotliDecompressSync } = await import("node:zlib");
  const sqlite = new DatabaseSync(path.resolve("data/asbir-handoff.sqlite"), { readOnly: true });
  const assetsFor = (id) => sqlite.prepare("SELECT * FROM handoff_asset WHERE handoff_version_id = ?").all(id);
  base = sqlite.prepare(
    `SELECT handoff_version.* FROM handoff_version JOIN handoff_version_snapshot ON handoff_version_snapshot.version_id = handoff_version.id
     WHERE visual_only = 0 AND source = 'figma' ORDER BY raw_bytes DESC`,
  ).all().find((version) => assetsFor(version.id).every((asset) => existsSync(path.resolve("data/objects", asset.object_key))));
  if (!base) throw new Error("No Figma capture found to build the sample from, locally or in the old SQLite data. Capture one first.");
  const { compressed } = sqlite.prepare("SELECT compressed FROM handoff_version_snapshot WHERE version_id = ?").get(base.id);
  baseSnapshot = JSON.parse(brotliDecompressSync(compressed).toString("utf8"));
  baseAssets = new Map(assetsFor(base.id).map((asset) => [asset.asset_key, asset]));
  console.log(`Using old SQLite capture "${base.version_label}" as the source.`);
}

// Screens with text layers, so there is something to edit.
const candidates = baseSnapshot.frames.filter((frame) => frame.nodes.some((node) => node.typography?.content));
if (candidates.length < SCREEN_COUNT) throw new Error(`The source capture needs at least ${SCREEN_COUNT} screens with text.`);
const [removed, edited1, edited2, same1, same2, added] = candidates.slice(0, SCREEN_COUNT);

async function buildSnapshot(keepFrames, edit) {
  const keep = new Set(keepFrames.map((frame) => frame.sourceFrameId));
  const { snapshot } = removeFramesFromSnapshot(
    baseSnapshot,
    baseSnapshot.frames.filter((frame) => !keep.has(frame.sourceFrameId)).map((frame) => frame.sourceFrameId),
  );
  const copy = structuredClone(snapshot);
  edit?.(copy);
  const finalized = await createSnapshotEnvelope(copy);
  if (!finalized.success) throw new Error("The sample snapshot is not valid: " + JSON.stringify(finalized.error?.issues?.slice(0, 3)));
  return finalized.data;
}

const firstText = (frame) => frame.nodes.find((node) => node.typography?.content);
const firstFilled = (frame) => frame.nodes.find((node) => node.fills?.some((paint) => paint.color) && !node.typography);

const before = await buildSnapshot([removed, edited1, edited2, same1, same2]);
const after = await buildSnapshot([edited1, edited2, same1, same2, added], (snapshot) => {
  const frameById = new Map(snapshot.frames.map((frame) => [frame.sourceFrameId, frame]));
  // Screen 1: new copy on a text layer and a new colour on a filled layer.
  const one = frameById.get(edited1.sourceFrameId);
  const text = firstText(one);
  text.typography.content = text.typography.content + " (updated)";
  if (typeof text.sourcePayload?.characters === "string") text.sourcePayload.characters = text.typography.content;
  const filled = firstFilled(one);
  if (filled) filled.fills = filled.fills.map((paint, index) => index === 0 ? { ...paint, color: "#E8590C" } : paint);
  // Screen 2: a text layer moves 12px right and gets a bigger font.
  const two = frameById.get(edited2.sourceFrameId);
  const moved = firstText(two);
  for (const key of ["bounds", "layoutBounds"]) {
    if (moved[key]?.x?.value != null) moved[key] = { ...moved[key], x: { ...moved[key].x, value: moved[key].x.value + 12 } };
  }
  if (moved.typography.fontSize?.value != null) {
    moved.typography.fontSize = { ...moved.typography.fontSize, value: moved.typography.fontSize.value + 2 };
  }
});

const existing = await database.query("SELECT id FROM project WHERE workspace_id = $1 AND name = $2", [company.id, PROJECT]);
await database.transaction(async () => {
  for (const { id } of existing.rows) {
    const handoffs = (await database.query("SELECT id FROM handoff WHERE project_id = $1", [id])).rows.map((row) => row.id);
    for (const handoffId of handoffs) {
      await database.query("DELETE FROM handoff_view WHERE handoff_id = $1", [handoffId]);
      await database.query("DELETE FROM handoff_asset WHERE handoff_version_id IN (SELECT id FROM handoff_version WHERE handoff_id = $1)", [handoffId]);
      await database.query("DELETE FROM handoff_version_snapshot WHERE version_id IN (SELECT id FROM handoff_version WHERE handoff_id = $1)", [handoffId]);
      await database.query("UPDATE handoff SET published_version_id = NULL WHERE id = $1", [handoffId]).catch(() => undefined);
      await database.query("DELETE FROM handoff_version WHERE handoff_id = $1", [handoffId]);
      await database.query("DELETE FROM handoff WHERE id = $1", [handoffId]);
    }
    await database.query("DELETE FROM project WHERE id = $1", [id]);
  }

  const projectId = randomUUID();
  const handoffId = randomUUID();
  await database.query(
    `INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [projectId, company.id, PROJECT, owner.id, isoHoursAgo(48)],
  );
  await database.query(
    `INSERT INTO handoff (id, workspace_id, project_id, name, created_by_user_id, created_at, sharing_mode)
     VALUES ($1, $2, $3, $4, $5, $6, 'workspace')`,
    [handoffId, company.id, projectId, "Checkout flow", owner.id, isoHoursAgo(48)],
  );
  const versions = [
    { label: "1.0", note: "First pass of the checkout flow.", snapshot: before, at: isoHoursAgo(30) },
    { label: "1.1", note: "Dropped one screen, added one, and updated copy, colour and spacing on two others.", snapshot: after, at: isoHoursAgo(2) },
  ];
  for (const version of versions) {
    const versionId = randomUUID();
    await database.query(
      `INSERT INTO handoff_version (id, workspace_id, handoff_id, version_label, release_note, source, source_file_id, source_revision_id,
         captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, '{}', $11, $12)`,
      [versionId, company.id, handoffId, version.label, version.note, base.source, base.source_file_id, base.source_revision_id,
        version.at, version.snapshot.contentHash, owner.id, version.at],
    );
    await storeCompressedSnapshot(database, versionId, JSON.stringify(version.snapshot));
    for (const asset of version.snapshot.assets) {
      const stored = baseAssets.get(asset.key);
      if (!stored) throw new Error(`Image ${asset.key} is missing from the source capture.`);
      await database.query(
        `INSERT INTO handoff_asset (id, workspace_id, handoff_version_id, asset_key, object_key, file_name, content_type, size_bytes, sha256, width, height, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [randomUUID(), company.id, versionId, stored.asset_key, stored.object_key, stored.file_name, stored.content_type,
          stored.size_bytes, stored.sha256, stored.width, stored.height, version.at],
      );
    }
  }
})();

console.log(`Created "${PROJECT}" → "Checkout flow" with versions 1.0 and 1.1.`);
console.log(`  Removed: ${removed.name}`);
console.log(`  Added:   ${added.name}`);
console.log(`  Changed: ${edited1.name} (text + colour), ${edited2.name} (position + font size)`);
