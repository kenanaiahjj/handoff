import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import test from "node:test";
import {
  createHandoffInviteInDatabase,
  getHandoffInviteByTokenInDatabase,
  listHandoffInvitesInDatabase,
  revokeHandoffInviteInDatabase,
  updateHandoffSharingModeInDatabase,
} from "../services/handoff-sharing-data.ts";

function createDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE "user" (id TEXT PRIMARY KEY);
    CREATE TABLE project (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, UNIQUE (id, workspace_id));
    CREATE TABLE handoff (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      review_share_id TEXT,
      published_version_id TEXT,
      UNIQUE (id, workspace_id),
      FOREIGN KEY (project_id, workspace_id) REFERENCES project (id, workspace_id) ON DELETE CASCADE
    );
    CREATE TABLE handoff_version (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      UNIQUE (id, workspace_id)
    );
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
  `);
  database.exec(readFileSync(new URL("../migrations/0012_handoff_sharing.sql", import.meta.url), "utf8"));
  database.exec(readFileSync(new URL("../migrations/0013_invite_roles_and_link_comments.sql", import.meta.url), "utf8"));
  database.prepare('INSERT INTO "user" (id) VALUES (?)').run("designer-1");
  database.prepare("INSERT INTO project (id, workspace_id) VALUES (?, ?)").run("project-1", "workspace-1");
  database.prepare(`INSERT INTO handoff
    (id, workspace_id, project_id, review_share_id, published_version_id)
    VALUES (?, ?, ?, ?, ?)`)
    .run("handoff-1", "workspace-1", "project-1", "share-1", "version-1");
  database.prepare("UPDATE handoff SET sharing_mode = 'invited' WHERE id = ?").run("handoff-1");
  return database;
}

test("external invite links are stored by token hash and require no workspace membership", () => {
  const database = createDatabase();
  const created = createHandoffInviteInDatabase(database, {
    id: "invite-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    handoffId: "handoff-1",
    email: "  QA.Person@Example.com ",
    role: "qa",
    token: "secret-invite-token",
    expiresAt: "2026-11-16T12:00:00.000Z",
    invitedByUserId: "designer-1",
    createdAt: "2026-11-09T12:00:00.000Z",
  });

  assert.deepEqual(created, {
    id: "invite-1",
    email: "qa.person@example.com",
    role: "qa",
    reviewShareId: "share-1",
    expiresAt: "2026-11-16T12:00:00.000Z",
    createdAt: "2026-11-09T12:00:00.000Z",
  });
  const stored = database.prepare("SELECT token_hash AS tokenHash FROM handoff_invite WHERE id = ?").get("invite-1");
  assert.notEqual(stored.tokenHash, "secret-invite-token");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM workspace_membership").get().count, 0);
  assert.equal(getHandoffInviteByTokenInDatabase(database, "share-1", "secret-invite-token").email, "qa.person@example.com");
  assert.equal(getHandoffInviteByTokenInDatabase(database, "share-1", "secret-invite-token").role, "qa");
  assert.equal(getHandoffInviteByTokenInDatabase(database, "another-share", "secret-invite-token"), null);

  database.close();
});

test("reissuing an email invite revokes the earlier token and invite revocation is scoped", () => {
  const database = createDatabase();
  const common = {
    workspaceId: "workspace-1",
    projectId: "project-1",
    handoffId: "handoff-1",
    email: "qa@example.com",
    invitedByUserId: "designer-1",
  };
  createHandoffInviteInDatabase(database, {
    ...common,
    id: "invite-1",
    token: "old-token",
    expiresAt: null,
    createdAt: "2026-11-09T12:00:00.000Z",
  });
  createHandoffInviteInDatabase(database, {
    ...common,
    id: "invite-2",
    token: "new-token",
    expiresAt: null,
    createdAt: "2026-11-09T12:01:00.000Z",
  });

  assert.equal(getHandoffInviteByTokenInDatabase(database, "share-1", "old-token"), null);
  assert.equal(getHandoffInviteByTokenInDatabase(database, "share-1", "new-token").id, "invite-2");
  assert.deepEqual(listHandoffInvitesInDatabase(database, {
    workspaceId: "workspace-1",
    handoffId: "handoff-1",
    now: "2026-11-09T12:02:00.000Z",
  }).map(({ id }) => id), ["invite-2"]);
  assert.equal(revokeHandoffInviteInDatabase(database, {
    workspaceId: "workspace-1",
    projectId: "project-1",
    handoffId: "handoff-1",
    inviteId: "invite-2",
    revokedAt: "2026-11-09T12:03:00.000Z",
  }), true);
  assert.equal(getHandoffInviteByTokenInDatabase(database, "share-1", "new-token"), null);
  assert.equal(revokeHandoffInviteInDatabase(database, {
    workspaceId: "workspace-1",
    projectId: "project-1",
    handoffId: "another-handoff",
    inviteId: "invite-2",
    revokedAt: "2026-11-09T12:04:00.000Z",
  }), false);

  database.close();
});

test("sharing mode cannot update a handoff in another project", () => {
  const database = createDatabase();
  assert.equal(updateHandoffSharingModeInDatabase(database, {
    workspaceId: "workspace-1",
    projectId: "project-1",
    handoffId: "handoff-1",
    mode: "anyone",
  }), true);
  assert.equal(database.prepare("SELECT sharing_mode AS mode FROM handoff WHERE id = ?").get("handoff-1").mode, "anyone");
  assert.equal(updateHandoffSharingModeInDatabase(database, {
    workspaceId: "workspace-1",
    projectId: "other-project",
    handoffId: "handoff-1",
    mode: "invited",
  }), false);
  database.close();
});

test("revoking the public link rotates its URL and revokes outstanding invitations", () => {
  const database = createDatabase();
  const input = {
    workspaceId: "workspace-1",
    projectId: "project-1",
    handoffId: "handoff-1",
  };
  createHandoffInviteInDatabase(database, {
    ...input,
    id: "invite-before-revoke",
    email: "qa@example.com",
    token: "invite-before-revoke-token",
    expiresAt: null,
    invitedByUserId: "designer-1",
    createdAt: "2026-11-09T12:00:00.000Z",
  });
  updateHandoffSharingModeInDatabase(database, { ...input, mode: "anyone" });
  const oldShareId = database.prepare("SELECT review_share_id AS id FROM handoff WHERE id = ?").get("handoff-1").id;

  const revoked = updateHandoffSharingModeInDatabase(database, {
    ...input,
    mode: "workspace",
    revokePublicLink: true,
  });
  const afterRevoke = database.prepare("SELECT review_share_id AS id, sharing_mode AS mode FROM handoff WHERE id = ?").get("handoff-1");
  const activeInvites = listHandoffInvitesInDatabase(database, { workspaceId: "workspace-1", handoffId: "handoff-1" });
  const oldInviteLookup = getHandoffInviteByTokenInDatabase(database, oldShareId, "invite-before-revoke-token");

  updateHandoffSharingModeInDatabase(database, { ...input, mode: "anyone" });
  const afterPublicAccessReopens = database.prepare("SELECT review_share_id AS id FROM handoff WHERE id = ?").get("handoff-1").id;
  database.close();

  assert.equal(revoked, true);
  assert.notEqual(afterRevoke.id, oldShareId);
  assert.equal(afterRevoke.mode, "workspace");
  assert.deepEqual(activeInvites, []);
  assert.equal(oldInviteLookup, null);
  assert.notEqual(afterPublicAccessReopens, oldShareId);
});
