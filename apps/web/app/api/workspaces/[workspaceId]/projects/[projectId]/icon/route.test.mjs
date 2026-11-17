import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";
import { createPostgresTestFixture } from "../../../../../../../src/server/test-support/postgres-test-fixture.mjs";

const priorSecret = process.env.BETTER_AUTH_SECRET;
const priorBaseUrl = process.env.BETTER_AUTH_URL;
const fixture = await createPostgresTestFixture();
const { pool, database } = fixture;
process.env.BETTER_AUTH_SECRET ??= "asbir-handoff-project-icon-route-test-secret-over-thirty-two";
process.env.BETTER_AUTH_URL = "http://localhost:3000";

await pool.query(`
  CREATE TABLE workspace_membership (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  );
  CREATE TABLE project (id TEXT NOT NULL PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'App', rules_json TEXT NOT NULL DEFAULT '{"allowedSpacing":[],"requireTokenCategories":[],"frameBounds":null}', pd_in_charge_user_id TEXT, created_at TEXT NOT NULL DEFAULT '2026-01-01');
  CREATE TABLE handoff (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    review_share_id TEXT,
    published_version_id TEXT,
    published_at TEXT,
    published_by_user_id TEXT,
    sharing_mode TEXT NOT NULL
  );
  CREATE TABLE handoff_invite (
    id TEXT NOT NULL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    handoff_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'exec',
    token_hash TEXT NOT NULL,
    expires_at TEXT,
    revoked_at TEXT,
    invited_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    image TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  );
  CREATE TABLE session (
    id TEXT PRIMARY KEY,
    "expiresAt" TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL
  );
  CREATE TABLE account (
    id TEXT PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TEXT,
    "refreshTokenExpiresAt" TEXT,
    scope TEXT,
    password TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  );
  CREATE TABLE verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    "expiresAt" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  );
`);
await pool.query(readFileSync(new URL("../../../../../../../src/server/migrations/0024_project_icons.sql", import.meta.url), "utf8").replaceAll("BLOB", "BYTEA"));

const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "10000000-0000-4000-8000-000000000001";
const now = "2026-11-11T12:00:00.000Z";
await database.prepare("INSERT INTO project (id, workspace_id) VALUES (?, ?)").run(projectId, workspaceId);
await database.prepare("INSERT INTO workspace_membership VALUES (?, 'designer-id', 'designer', ?), (?, 'qa-id', 'qa', ?)").run(workspaceId, now, workspaceId, now);

const { auth } = await import("@/src/server/auth.ts");
const originalGetSession = auth.api.getSession;
let currentSession = { user: { id: "designer-id", email: "dee@example.com" } };
auth.api.getSession = async () => currentSession;
const { GET, PUT, DELETE } = await import("./route.ts");

const url = `http://localhost:3000/api/workspaces/${workspaceId}/projects/${projectId}/icon`;
const context = { params: Promise.resolve({ workspaceId, projectId }) };
// A real 1×1 PNG.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const put = (body, type = "image/png") => PUT(new Request(url, { method: "PUT", headers: { "content-type": type }, body }), context);

after(async () => {
  auth.api.getSession = originalGetSession;
  await fixture.close();
  if (priorSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = priorSecret;
  if (priorBaseUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = priorBaseUrl;
});

test("designers upload a project icon and everyone on the team can see it", async () => {
  const response = await put(png);
  assert.equal(response.status, 200);
  const { iconVersion } = await response.json();
  assert.match(iconVersion, /^[0-9a-f]{12}$/);

  currentSession = { user: { id: "qa-id", email: "qa@example.com" } };
  const icon = await GET(new Request(`${url}?v=${iconVersion}`), context);
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await icon.arrayBuffer()), png);
  currentSession = { user: { id: "designer-id", email: "dee@example.com" } };
});

test("only real PNG, JPEG or WebP images are accepted (no SVG)", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const response = await put(svg, "image/png");
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /PNG, JPEG or WebP/);
});

test("reviewers, developers and QA cannot change or remove the icon", async () => {
  currentSession = { user: { id: "qa-id", email: "qa@example.com" } };
  assert.equal((await put(png)).status, 403);
  assert.equal((await DELETE(new Request(url, { method: "DELETE" }), context)).status, 403);
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM project_icon").get()).count, 1);
  currentSession = { user: { id: "designer-id", email: "dee@example.com" } };
});

test("removing the icon makes it disappear", async () => {
  assert.equal((await DELETE(new Request(url, { method: "DELETE" }), context)).status, 200);
  assert.equal((await GET(new Request(url), context)).status, 404);
});
