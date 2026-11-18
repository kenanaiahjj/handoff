import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";
import {
  createHandoffInviteInDatabase,
  getHandoffInviteByTokenInDatabase,
  listHandoffInvitesInDatabase,
  revokeHandoffInviteInDatabase,
  updateHandoffSharingModeInDatabase,
} from "../services/handoff-sharing-data.ts";

async function createDatabase() {
  const fixture = await createPostgresTestFixture();
  const { database, pool } = fixture;
  await pool.query(`
    CREATE TABLE "user" (id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS user_presence (user_id TEXT PRIMARY KEY, last_seen_at TIMESTAMPTZ);
    CREATE TABLE project (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, UNIQUE (id, workspace_id));
    CREATE TABLE handoff (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      review_share_id TEXT,
      published_version_id TEXT,
      sharing_mode TEXT NOT NULL DEFAULT 'workspace',
      UNIQUE (id, workspace_id),
      FOREIGN KEY (project_id, workspace_id) REFERENCES project (id, workspace_id) ON DELETE CASCADE
    );
    CREATE TABLE handoff_version (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      UNIQUE (id, workspace_id)
    );
    CREATE TABLE IF NOT EXISTS handoff_version_snapshot (version_id TEXT PRIMARY KEY, encoding TEXT NOT NULL, compressed BYTEA NOT NULL, raw_bytes INTEGER NOT NULL, frame_index TEXT NOT NULL);
    CREATE TABLE handoff_comment (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      handoff_version_id TEXT NOT NULL,
      frame_id TEXT NOT NULL,
      source_node_id TEXT,
      x REAL,
      y REAL,
      parent_comment_id TEXT,
      body TEXT NOT NULL,
      resolved_at TEXT,
      resolved_by_user_id TEXT,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE workspace_membership (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id));
    CREATE TABLE handoff_invite (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      handoff_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'exec',
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT,
      revoked_at TEXT,
      invited_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  CREATE TABLE IF NOT EXISTS project_member (project_id TEXT, workspace_id TEXT, email TEXT, role TEXT, added_by_user_id TEXT, created_at TEXT);
  `);
  await pool.query("CREATE UNIQUE INDEX handoff_invite_active_email_unique ON handoff_invite (handoff_id, email) WHERE revoked_at IS NULL");
  await database.prepare('INSERT INTO "user" (id) VALUES (?)').run("designer-1");
  await database.prepare("INSERT INTO project (id, workspace_id) VALUES (?, ?)").run("project-1", "workspace-1");
  await database.prepare(`INSERT INTO handoff
    (id, workspace_id, project_id, review_share_id, published_version_id, sharing_mode)
    VALUES (?, ?, ?, ?, ?, 'invited')`)
    .run("handoff-1", "workspace-1", "project-1", "share-1", "version-1");
  return fixture;
}

test("external invite links are stored by token hash and require no workspace membership", async () => {
  const fixture = await createDatabase();
  const { database } = fixture;
  try {
  const created = await createHandoffInviteInDatabase(database, {
    id: "invite-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    handoffId: "handoff-1",
    email: "  QA.Person@Example.com ",
    role: "qa",
    token: "secret-invite-token",
    expiresAt: "2099-11-16T12:00:00.000Z",
    invitedByUserId: "designer-1",
    createdAt: "2026-11-09T12:00:00.000Z",
  });

  assert.deepEqual(created, {
    id: "invite-1",
    email: "qa.person@example.com",
    role: "qa",
    reviewShareId: "share-1",
    expiresAt: "2099-11-16T12:00:00.000Z",
    createdAt: "2026-11-09T12:00:00.000Z",
  });
  const stored = await database.prepare("SELECT token_hash AS tokenHash FROM handoff_invite WHERE id = ?").get("invite-1");
  assert.notEqual(stored.tokenHash, "secret-invite-token");
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM workspace_membership").get()).count, 0);
  assert.equal((await getHandoffInviteByTokenInDatabase(database, "share-1", "secret-invite-token")).email, "qa.person@example.com");
  assert.equal((await getHandoffInviteByTokenInDatabase(database, "share-1", "secret-invite-token")).role, "qa");
  assert.equal(await getHandoffInviteByTokenInDatabase(database, "another-share", "secret-invite-token"), null);
  } finally {
    await fixture.close();
  }
});

test("reissuing an email invite revokes the earlier token and invite revocation is scoped", async () => {
  const fixture = await createDatabase();
  const { database } = fixture;
  try {
  const common = {
    workspaceId: "workspace-1",
    projectId: "project-1",
    handoffId: "handoff-1",
    email: "qa@example.com",
    invitedByUserId: "designer-1",
  };
  await createHandoffInviteInDatabase(database, {
    ...common,
    id: "invite-1",
    token: "old-token",
    expiresAt: null,
    createdAt: "2026-11-09T12:00:00.000Z",
  });
  await createHandoffInviteInDatabase(database, {
    ...common,
    id: "invite-2",
    token: "new-token",
    expiresAt: null,
    createdAt: "2026-11-09T12:01:00.000Z",
  });

  assert.equal(await getHandoffInviteByTokenInDatabase(database, "share-1", "old-token"), null);
  assert.equal((await getHandoffInviteByTokenInDatabase(database, "share-1", "new-token")).id, "invite-2");
  assert.deepEqual((await listHandoffInvitesInDatabase(database, {
    workspaceId: "workspace-1",
    handoffId: "handoff-1",
    now: "2026-11-09T12:02:00.000Z",
  })).map(({ id }) => id), ["invite-2"]);
  assert.equal(await revokeHandoffInviteInDatabase(database, {
    workspaceId: "workspace-1",
    projectId: "project-1",
    handoffId: "handoff-1",
    inviteId: "invite-2",
    revokedAt: "2026-11-09T12:03:00.000Z",
  }), true);
  assert.equal(await getHandoffInviteByTokenInDatabase(database, "share-1", "new-token"), null);
  assert.equal(await revokeHandoffInviteInDatabase(database, {
    workspaceId: "workspace-1",
    projectId: "project-1",
    handoffId: "another-handoff",
    inviteId: "invite-2",
    revokedAt: "2026-11-09T12:04:00.000Z",
  }), false);

  } finally {
    await fixture.close();
  }
});

test("sharing mode cannot update a handoff in another project", async () => {
  const fixture = await createDatabase();
  const { database } = fixture;
  try {
  assert.equal(await updateHandoffSharingModeInDatabase(database, {
    workspaceId: "workspace-1",
    projectId: "project-1",
    handoffId: "handoff-1",
    mode: "anyone",
  }), true);
  assert.equal((await database.prepare("SELECT sharing_mode AS mode FROM handoff WHERE id = ?").get("handoff-1")).mode, "anyone");
  assert.equal(await updateHandoffSharingModeInDatabase(database, {
    workspaceId: "workspace-1",
    projectId: "other-project",
    handoffId: "handoff-1",
    mode: "invited",
  }), false);
  } finally {
    await fixture.close();
  }
});

test("revoking the public link rotates its URL and revokes outstanding invitations", async () => {
  const fixture = await createDatabase();
  const { database } = fixture;
  try {
  const input = {
    workspaceId: "workspace-1",
    projectId: "project-1",
    handoffId: "handoff-1",
  };
  await createHandoffInviteInDatabase(database, {
    ...input,
    id: "invite-before-revoke",
    email: "qa@example.com",
    token: "invite-before-revoke-token",
    expiresAt: null,
    invitedByUserId: "designer-1",
    createdAt: "2026-11-09T12:00:00.000Z",
  });
  await updateHandoffSharingModeInDatabase(database, { ...input, mode: "anyone" });
  const oldShareId = (await database.prepare("SELECT review_share_id AS id FROM handoff WHERE id = ?").get("handoff-1")).id;

  const revoked = await updateHandoffSharingModeInDatabase(database, {
    ...input,
    mode: "workspace",
    revokePublicLink: true,
  });
  const afterRevoke = await database.prepare("SELECT review_share_id AS id, sharing_mode AS mode FROM handoff WHERE id = ?").get("handoff-1");
  const activeInvites = await listHandoffInvitesInDatabase(database, { workspaceId: "workspace-1", handoffId: "handoff-1" });
  const oldInviteLookup = await getHandoffInviteByTokenInDatabase(database, oldShareId, "invite-before-revoke-token");

  await updateHandoffSharingModeInDatabase(database, { ...input, mode: "anyone" });
  const afterPublicAccessReopens = (await database.prepare("SELECT review_share_id AS id FROM handoff WHERE id = ?").get("handoff-1")).id;

  assert.equal(revoked, true);
  assert.notEqual(afterRevoke.id, oldShareId);
  assert.equal(afterRevoke.mode, "workspace");
  assert.deepEqual(activeInvites, []);
  assert.equal(oldInviteLookup, null);
  assert.notEqual(afterPublicAccessReopens, oldShareId);
  } finally {
    await fixture.close();
  }
});
