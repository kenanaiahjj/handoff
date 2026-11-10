import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test, { after, beforeEach } from "node:test";
import { hashHandoffInviteToken } from "@/src/server/services/handoff-sharing.ts";

const priorDatabase = globalThis.__asbirDatabase;
const priorSecret = process.env.BETTER_AUTH_SECRET;
const priorBaseUrl = process.env.BETTER_AUTH_URL;
const database = new Database(":memory:");
globalThis.__asbirDatabase = database;
process.env.BETTER_AUTH_SECRET ??= "asbir-handoff-route-test-secret-with-more-than-thirty-two-bytes";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

database.exec(`
  CREATE TABLE workspace_membership (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  );
  CREATE TABLE project (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    rules_json TEXT NOT NULL,
    pd_in_charge_user_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE handoff (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    review_share_id TEXT UNIQUE,
    published_version_id TEXT,
    published_at TEXT,
    published_by_user_id TEXT,
    sharing_mode TEXT NOT NULL DEFAULT 'workspace'
  );
  CREATE TABLE handoff_version (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    handoff_id TEXT NOT NULL,
    version_label TEXT NOT NULL,
    release_note TEXT,
    source TEXT NOT NULL,
    source_file_id TEXT NOT NULL,
    source_revision_id TEXT,
    captured_at TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    visual_only INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE handoff_asset (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    handoff_version_id TEXT NOT NULL,
    asset_key TEXT NOT NULL,
    object_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    width INTEGER,
    height INTEGER
  );
  CREATE TABLE handoff_invite (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    handoff_id TEXT NOT NULL,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TEXT,
    revoked_at TEXT,
    invited_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
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
  CREATE TABLE "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    emailVerified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE session (
    id TEXT PRIMARY KEY,
    expiresAt TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    userId TEXT NOT NULL
  );
  CREATE TABLE account (
    id TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    userId TEXT NOT NULL,
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt TEXT,
    refreshTokenExpiresAt TEXT,
    scope TEXT,
    password TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);

const now = "2026-11-09T12:00:00.000Z";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "10000000-0000-4000-8000-000000000001";
const handoffId = "20000000-0000-4000-8000-000000000001";
const shareId = "share-handoff";
const frameId = "screen-home";
const publishedVersionId = "30000000-0000-4000-8000-000000000002";
const priorVersionId = "30000000-0000-4000-8000-000000000001";
const newerDraftVersionId = "30000000-0000-4000-8000-000000000003";
const inviteToken = "review-invite-token";

const measurement = (value, sourceProperty) => ({ value, unit: "px", provenance: "source", sourceProperty });
const snapshot = {
  schemaVersion: 1,
  source: "figma",
  sourceFileId: "figma-file",
  sourceRevisionId: null,
  sourceFileName: "Review access test fixture",
  capturedAt: now,
  contentHash: "a".repeat(64),
  overviewAssetKey: "overview",
  frames: [{
    sourceFrameId: frameId,
    sourcePageId: "page-home",
    name: "Home",
    bounds: {
      x: measurement(0, "x"),
      y: measurement(0, "y"),
      width: measurement(320, "width"),
      height: measurement(640, "height"),
    },
    renderAssetKey: "screen",
    nodes: [],
  }],
  assets: [
    { key: "overview", fileName: "overview.png", contentType: "image/png", sizeBytes: 0, sha256: "b".repeat(64), width: 320, height: 640 },
    { key: "screen", fileName: "home.png", contentType: "image/png", sizeBytes: 0, sha256: "c".repeat(64), width: 320, height: 640 },
  ],
  sourceMetadata: {},
};

const { auth } = await import("@/src/server/auth.ts");
const { GET: getLatest } = await import("../../../app/api/review/[shareId]/latest/route.ts");
const { GET: getComments, POST: postComment } = await import("../../../app/api/review/[shareId]/versions/[versionId]/comments/route.ts");
const { handoffReviewAccessCookieName } = await import("@/src/server/services/handoff-review-access.ts");

let currentSession = null;
const originalGetSession = auth.api.getSession;
auth.api.getSession = async () => currentSession;

function seedHandoff(mode = "anyone") {
  database.prepare("INSERT INTO project (id, workspace_id, name, rules_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(projectId, workspaceId, "Test project", "{}", now);
  database.prepare(`INSERT INTO handoff
    (id, workspace_id, project_id, name, created_at, review_share_id, published_version_id, published_at, published_by_user_id, sharing_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(handoffId, workspaceId, projectId, "Test handoff", now, shareId, publishedVersionId, now, "owner-id", mode);

  for (const [id, label, createdAt] of [
    [priorVersionId, "1", "2026-11-07T12:00:00.000Z"],
    [publishedVersionId, "2", "2026-11-08T12:00:00.000Z"],
    [newerDraftVersionId, "3 draft", "2026-11-09T12:00:00.000Z"],
  ]) {
    database.prepare(`INSERT INTO handoff_version
      (id, workspace_id, handoff_id, version_label, release_note, source, source_file_id,
       source_revision_id, captured_at, content_hash, visual_only, snapshot_json, created_by_user_id, created_at)
      VALUES (?, ?, ?, ?, NULL, 'figma', 'figma-file', NULL, ?, ?, 0, ?, 'owner-id', ?)`)
      .run(id, workspaceId, handoffId, label, now, snapshot.contentHash, JSON.stringify(snapshot), createdAt);
  }
}

function reviewRequest(endpoint, init = {}) {
  return new Request(`http://localhost:3000/api/review/${shareId}/${endpoint}`, init);
}

function reviewContext(versionId) {
  return { params: Promise.resolve({ shareId, versionId }) };
}

beforeEach(() => {
  database.exec(`
    DELETE FROM handoff_comment;
    DELETE FROM handoff_invite;
    DELETE FROM handoff_asset;
    DELETE FROM handoff_version;
    DELETE FROM workspace_membership;
    DELETE FROM handoff;
    DELETE FROM project;
    DELETE FROM "user";
  `);
  currentSession = null;
  seedHandoff();
});

after(() => {
  auth.api.getSession = originalGetSession;
  database.close();
  if (priorDatabase === undefined) delete globalThis.__asbirDatabase;
  else globalThis.__asbirDatabase = priorDatabase;
  if (priorSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = priorSecret;
  if (priorBaseUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = priorBaseUrl;
});

test("public review reads only the published version and earlier snapshots", async () => {
  const response = await getLatest(reviewRequest("latest"), { params: Promise.resolve({ shareId }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    versionId: publishedVersionId,
    versionLabel: "2",
    publishedAt: now,
    publishedVersions: [
      { id: publishedVersionId, versionLabel: "2" },
      { id: priorVersionId, versionLabel: "1" },
    ],
  });

  const hiddenDraft = await getComments(reviewRequest(`versions/${newerDraftVersionId}/comments`), reviewContext(newerDraftVersionId));
  assert.equal(hiddenDraft.status, 404);
});

test("anonymous public viewers can read comments but cannot add them", async () => {
  const comments = await getComments(reviewRequest(`versions/${publishedVersionId}/comments`), reviewContext(publishedVersionId));
  assert.equal(comments.status, 200);
  assert.deepEqual(await comments.json(), { comments: [] });

  const response = await postComment(reviewRequest(`versions/${publishedVersionId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: "Anonymous write attempt", frameId, x: 10, y: 10 }),
  }), reviewContext(publishedVersionId));
  assert.equal(response.status, 403);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM handoff_comment").get().count, 0);
});

test("signed-in workspace members can comment while the canvas link is public", async () => {
  database.prepare("INSERT INTO workspace_membership (workspace_id, user_id, role, created_at) VALUES (?, ?, 'qa', ?)")
    .run(workspaceId, "qa-user", now);
  database.prepare(`INSERT INTO "user" (id, name, email, createdAt, updatedAt)
    VALUES ('qa-user', 'QA reviewer', 'qa@example.com', ?, ?)`)
    .run(now, now);
  currentSession = { user: { id: "qa-user", email: "qa@example.com" } };

  const response = await postComment(reviewRequest(`versions/${publishedVersionId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: "Team review comment", frameId, x: 10, y: 10 }),
  }), reviewContext(publishedVersionId));
  assert.equal(response.status, 201);
  assert.equal(database.prepare("SELECT body FROM handoff_comment").get().body, "Team review comment");
});

test("workspace-only review denies unauthenticated reads", async () => {
  database.prepare("UPDATE handoff SET sharing_mode = 'workspace' WHERE id = ?").run(handoffId);
  const response = await getLatest(reviewRequest("latest"), { params: Promise.resolve({ shareId }) });
  assert.equal(response.status, 401);
});

test("invite access requires the invited email and keeps the token scoped to the published handoff", async () => {
  database.prepare("UPDATE handoff SET sharing_mode = 'invited' WHERE id = ?").run(handoffId);
  database.prepare(`INSERT INTO handoff_invite
    (id, workspace_id, handoff_id, email, token_hash, expires_at, revoked_at, invited_by_user_id, created_at)
    VALUES ('invite-id', ?, ?, 'external@example.com', ?, NULL, NULL, 'owner-id', ?)`)
    .run(workspaceId, handoffId, hashHandoffInviteToken(inviteToken), now);
  const inviteCookie = `${handoffReviewAccessCookieName(shareId)}=${encodeURIComponent(inviteToken)}`;
  currentSession = { user: { id: "external-user", email: "external@example.com" } };

  const allowed = await getLatest(reviewRequest("latest", { headers: { cookie: inviteCookie } }), { params: Promise.resolve({ shareId }) });
  assert.equal(allowed.status, 200);

  currentSession = { user: { id: "different-user", email: "other@example.com" } };
  const denied = await getLatest(reviewRequest("latest", { headers: { cookie: inviteCookie } }), { params: Promise.resolve({ shareId }) });
  assert.equal(denied.status, 404);
});
