// Dev-only: creates sample projects with handoffs shared to the local reviewer account, so the
// reviewer side of the app has something to show. Each sample handoff is a slice of an existing
// Figma capture (same images, fewer screens), so every canvas opens normally.
//
// Run from the repo root while no capture is being uploaded:
//   node --experimental-transform-types --loader ./scripts/node-esm-loader.mjs scripts/seed-sample-projects.mjs
//
// Safe to rerun: projects that already exist (by name) are skipped.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

process.chdir(path.resolve("apps/web"));
const { getDatabase } = await import("@/src/server/db.ts");
const { localReviewerUser } = await import("@/src/server/auth-session.ts");
const { createSnapshotEnvelope, removeFramesFromSnapshot } = await import("@asbir/snapshot-contract");
const { readSnapshotJson, storeCompressedSnapshot } = await import("@/src/server/storage/snapshot-store.ts");

const database = getDatabase();
const DAY = 86_400_000;
const isoDaysAgo = (days) => new Date(Date.now() - days * DAY).toISOString();

// Screens are picked by name prefix, e.g. "Booking - Passenger" matches "Booking - Passenger Details".
// `seen` is the version index the reviewer last opened (null = never), which drives the "New" dots.
const samples = [
  {
    project: "Maayo Ferries",
    handoffs: [
      { name: "Passenger details", screens: ["Booking - Passenger", "Passenger -"], versions: [{ label: "1.0", daysAgo: 12, keep: 0.5 }, { label: "1.1", daysAgo: 1 }], seen: 0 },
      { name: "Rebooking", screens: ["Booking - Rebook"], versions: [{ label: "1.0", daysAgo: 9 }], seen: 0 },
      { name: "Return trips", screens: ["Booking - Return", "Booking - Departure"], versions: [{ label: "1.0", daysAgo: 0.2 }], seen: null },
      { name: "Ticket wallet", screens: ["Tickets - Ticket", "Tickets - Pending", "Tickets - Departed", "Tickets - Expired"], versions: [{ label: "2.0", daysAgo: 20, keep: 0.6 }, { label: "2.1", daysAgo: 6 }], seen: 1 },
      // Not shared with the reviewer: proves hidden handoffs stay hidden.
      { name: "Refunds & cancellations", screens: ["Booking - Maayo", "Tickets - Refunded", "Tickets - Partial"], versions: [{ label: "1.0", daysAgo: 3 }], seen: null, shared: false },
    ],
  },
  {
    project: "OceanJet Partners",
    handoffs: [
      { name: "Operator schedules", screens: ["Schedule -", "Asset - Schedule"], versions: [{ label: "0.9", daysAgo: 15, keep: 0.5 }, { label: "1.0", daysAgo: 2 }], seen: 0 },
      { name: "Brand kit", screens: ["Asset - Brand", "Module - Global", "Global -", "Overlay - Global"], versions: [{ label: "1.0", daysAgo: 30 }], seen: 0 },
    ],
  },
  {
    project: "LMF Ventures Labs",
    handoffs: [
      { name: "Home & profile", screens: ["Home -", "Profile -", "Support -"], versions: [{ label: "1.0", daysAgo: 0.5 }], seen: null },
      { name: "Sign up", screens: ["Onboarding -", "Booking - Guest", "Booking - Email"], versions: [{ label: "1.0", daysAgo: 25 }], seen: 0 },
    ],
  },
];

const owner = database
  .prepare(`SELECT "user".id FROM workspace_membership JOIN "user" ON "user".id = workspace_membership.user_id
            WHERE workspace_membership.role = 'owner' ORDER BY workspace_membership.created_at ASC LIMIT 1`)
  .get();
if (!owner) throw new Error("No workspace owner found. Sign in and create a workspace first.");

const base = database
  .prepare(
    `SELECT handoff_version.* FROM handoff_version
     LEFT JOIN handoff_version_snapshot ON handoff_version_snapshot.version_id = handoff_version.id
     WHERE visual_only = 0 AND source = 'figma'
     ORDER BY COALESCE(handoff_version_snapshot.raw_bytes, length(handoff_version.snapshot_json)) DESC LIMIT 1`,
  )
  .get();
if (!base) throw new Error("No Figma capture found to build samples from. Upload one first.");
const baseSnapshot = JSON.parse(readSnapshotJson(database, base.id, base.workspace_id));
const baseAssets = new Map(
  database.prepare("SELECT * FROM handoff_asset WHERE handoff_version_id = ?").all(base.id).map((asset) => [asset.asset_key, asset]),
);

// Make sure the local reviewer exists (the dev "View as" switcher normally creates it).
const now = new Date().toISOString();
database
  .prepare(`INSERT OR IGNORE INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 1, NULL, ?, ?)`)
  .run(localReviewerUser.id, localReviewerUser.name, localReviewerUser.email, now, now);

async function sliceSnapshot(prefixes, keep = 1) {
  const matching = baseSnapshot.frames.filter((frame) => prefixes.some((prefix) => frame.name.startsWith(prefix)));
  if (!matching.length) throw new Error(`No screens match ${prefixes.join(", ")}.`);
  const kept = new Set(matching.slice(0, Math.max(1, Math.ceil(matching.length * keep))).map((frame) => frame.sourceFrameId));
  const removeIds = baseSnapshot.frames.filter((frame) => !kept.has(frame.sourceFrameId)).map((frame) => frame.sourceFrameId);
  const { snapshot } = removeFramesFromSnapshot(baseSnapshot, removeIds);
  const finalized = await createSnapshotEnvelope(snapshot);
  if (!finalized.success) throw new Error("A sample snapshot is not valid.");
  return finalized.data;
}

const insert = {
  workspace: database.prepare("INSERT INTO workspace (id, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?)"),
  membership: database.prepare("INSERT OR IGNORE INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)"),
  project: database.prepare("INSERT INTO project (id, workspace_id, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?)"),
  handoff: database.prepare(
    "INSERT INTO handoff (id, workspace_id, project_id, name, created_by_user_id, created_at, sharing_mode) VALUES (?, ?, ?, ?, ?, ?, 'invited')",
  ),
  version: database.prepare(
    `INSERT INTO handoff_version (id, workspace_id, handoff_id, version_label, release_note, source, source_file_id, source_revision_id,
       captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ),
  asset: database.prepare(
    `INSERT INTO handoff_asset (id, workspace_id, handoff_version_id, asset_key, object_key, file_name, content_type, size_bytes, sha256, width, height, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  invite: database.prepare(
    `INSERT INTO handoff_invite (id, workspace_id, handoff_id, email, token_hash, expires_at, revoked_at, invited_by_user_id, created_at, role)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'exec')`,
  ),
  seen: database.prepare(
    `INSERT INTO handoff_view (user_id, workspace_id, handoff_id, last_seen_version_id, seen_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, handoff_id) DO UPDATE SET last_seen_version_id = excluded.last_seen_version_id, seen_at = excluded.seen_at`,
  ),
};

// Everything lives in the one company workspace (the oldest), as projects.
const company = database.prepare("SELECT id FROM workspace ORDER BY created_at ASC, id ASC LIMIT 1").get();
if (!company) throw new Error("No workspace yet. Sign in once to set it up.");
insert.membership.run(company.id, localReviewerUser.id, "reviewer", now);

for (const sample of samples) {
  if (database.prepare("SELECT 1 FROM project WHERE workspace_id = ? AND name = ?").get(company.id, sample.project)) {
    console.log(`Skipped "${sample.project}" (already exists).`);
    continue;
  }
  // Build every snapshot first (async), then write the project in one transaction.
  const plan = [];
  for (const handoff of sample.handoffs) {
    const versions = [];
    for (const version of handoff.versions) versions.push({ ...version, snapshot: await sliceSnapshot(handoff.screens, version.keep) });
    plan.push({ handoff, versions });
  }

  const workspaceId = company.id;
  const createdAt = isoDaysAgo(40);
  let shared = 0;
  database.transaction(() => {
    const projectId = randomUUID();
    insert.project.run(projectId, workspaceId, sample.project, owner.id, createdAt);
    for (const { handoff, versions } of plan) {
      const handoffId = randomUUID();
      insert.handoff.run(handoffId, workspaceId, projectId, handoff.name, owner.id, isoDaysAgo(versions[0].daysAgo + 1));

      const versionIds = versions.map((version) => {
        const versionId = randomUUID();
        const versionCreatedAt = isoDaysAgo(version.daysAgo);
        insert.version.run(
          versionId, workspaceId, handoffId, version.label, `Sample data: ${version.snapshot.frames.length} screens.`,
          base.source, base.source_file_id, base.source_revision_id, versionCreatedAt, version.snapshot.contentHash,
          "{}", owner.id, versionCreatedAt,
        );
        storeCompressedSnapshot(database, versionId, JSON.stringify(version.snapshot));
        for (const asset of version.snapshot.assets) {
          const stored = baseAssets.get(asset.key);
          if (!stored) throw new Error(`Image ${asset.key} is missing from the source capture.`);
          insert.asset.run(
            randomUUID(), workspaceId, versionId, stored.asset_key, stored.object_key, stored.file_name, stored.content_type,
            stored.size_bytes, stored.sha256, stored.width, stored.height, versionCreatedAt,
          );
        }
        return versionId;
      });

      if (handoff.shared === false) continue;
      shared += 1;
      const tokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
      insert.invite.run(randomUUID(), workspaceId, handoffId, localReviewerUser.email, tokenHash, owner.id, createdAt);
      if (handoff.seen !== null) insert.seen.run(localReviewerUser.id, workspaceId, handoffId, versionIds[handoff.seen], isoDaysAgo(versions[handoff.seen].daysAgo));
    }
  })();
  console.log(`Created project "${sample.project}": ${plan.length} handoffs, ${shared} shared with ${localReviewerUser.email}.`);
}
