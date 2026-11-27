import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";

const prior = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM, env: process.env.VERCEL_ENV };
const fixture = await createPostgresTestFixture();
const { database, pool } = fixture;

await pool.query(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT, email TEXT);
  CREATE TABLE project (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, pd_in_charge_user_id TEXT);
  CREATE TABLE handoff (id TEXT PRIMARY KEY, workspace_id TEXT, project_id TEXT, name TEXT);
  CREATE TABLE project_member (project_id TEXT, workspace_id TEXT, email TEXT, role TEXT, added_by_user_id TEXT, created_at TEXT);
  CREATE TABLE handoff_version (id TEXT PRIMARY KEY, handoff_id TEXT, version_label TEXT, created_by_user_id TEXT, created_at TEXT, snapshot_json TEXT);
  CREATE TABLE IF NOT EXISTS handoff_version_snapshot (version_id TEXT PRIMARY KEY, encoding TEXT NOT NULL, compressed BYTEA NOT NULL, raw_bytes INTEGER NOT NULL, frame_index TEXT NOT NULL);
  CREATE TABLE handoff_asset (handoff_version_id TEXT, asset_key TEXT, object_key TEXT);
`);
await database.prepare(`INSERT INTO "user" VALUES ('designer', 'Dee Designer', 'Dee@lmf.ventures'), ('pd', 'Pat Lead', 'pat@lmf.ventures')`).run();
await database.prepare("INSERT INTO project VALUES ('p', 'ws', 'Maayo', 'pd'), ('other', 'ws', 'Other', NULL)").run();
await database.prepare("INSERT INTO handoff VALUES ('h', 'ws', 'p', 'Rebooking')").run();
// The designer is on the team too; the outsider is on another project and must never hear about this one.
await database.prepare("INSERT INTO project_member VALUES ('p', 'ws', 'devin@lmf.ventures', 'dev', 'designer', 'now'), ('p', 'ws', 'dee@lmf.ventures', 'pd', 'designer', 'now'), ('p', 'ws', 'pat@lmf.ventures', 'pd', 'designer', 'now'), ('other', 'ws', 'outsider@lmf.ventures', 'dev', 'designer', 'now')").run();
const frames = (keys) => JSON.stringify({ frames: keys.map((key) => ({ sourceFrameId: key, name: key, renderAssetKey: key })) });
await database.prepare("INSERT INTO handoff_version VALUES ('v1', 'h', '1.0', 'designer', '2026-01-01', ?), ('v2', 'h', '1.1', 'designer', '2026-01-02', ?)").run(frames(["a", "b"]), frames(["a", "b", "c"]));
await database.prepare("INSERT INTO handoff_asset VALUES ('v1', 'a', 'x'), ('v1', 'b', 'y'), ('v2', 'a', 'x'), ('v2', 'b', 'y2'), ('v2', 'c', 'z')").run();

const { isEmailEnabled, emailNewVersion, emailNewComment, projectTeamEmails, renderEmail } = await import("./email.ts");

after(async () => {
  for (const [name, value] of [["RESEND_API_KEY", prior.key], ["EMAIL_FROM", prior.from], ["VERCEL_ENV", prior.env]]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await fixture.close();
});

function fakeResend() {
  const batches = [];
  const fetcher = async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails/batch");
    batches.push(JSON.parse(init.body));
    return Response.json({ data: [] });
  };
  return { fetcher, batches };
}

function enable() {
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "Asbir Handoff <handoff@example.com>";
  delete process.env.VERCEL_ENV;
}

test("sends nothing without a key, or on Vercel Preview", async () => {
  delete process.env.RESEND_API_KEY;
  assert.equal(isEmailEnabled(), false);
  enable();
  process.env.VERCEL_ENV = "preview";
  assert.equal(isEmailEnabled(), false);
  const { fetcher, batches } = fakeResend();
  assert.deepEqual(await emailNewVersion({ workspaceId: "ws", handoffId: "h", versionId: "v2", createdBy: "designer" }, fetcher), { sent: 0 });
  assert.equal(batches.length, 0);
});

test("the project team is its members plus the PD, once each", async () => {
  assert.deepEqual((await projectTeamEmails("h")).sort(), ["dee@lmf.ventures", "devin@lmf.ventures", "pat@lmf.ventures"]);
});

test("a new version emails the project team, not the publisher", async () => {
  enable();
  const { fetcher, batches } = fakeResend();
  const result = await emailNewVersion({ workspaceId: "ws", handoffId: "h", versionId: "v2", createdBy: "designer" }, fetcher);
  assert.equal(result.sent, 2);
  const emails = batches[0];
  assert.deepEqual(emails.map((email) => email.to[0]).sort(), ["devin@lmf.ventures", "pat@lmf.ventures"]);
  assert.equal(emails[0].subject, "Rebooking 1.1 is ready");
  assert.match(emails[0].text, /Dee Designer published version 1\.1 of Rebooking/);
  assert.match(emails[0].text, /1 screen changed · 1 new/);
  assert.match(emails[0].html, /compareFrom=v1&amp;compareTo=v2/);
});

test("comments email the team except the author, including invite-link reviewers' comments", async () => {
  enable();
  let { fetcher, batches } = fakeResend();
  await emailNewComment({ handoffId: "h", versionId: "v2", commentId: "c1", body: "Button looks <off>", authorId: "pd", isReply: false }, fetcher);
  assert.deepEqual(batches[0].map((email) => email.to[0]).sort(), ["dee@lmf.ventures", "devin@lmf.ventures"]);
  assert.equal(batches[0][0].subject, "Pat Lead commented on Rebooking");
  assert.match(batches[0][0].html, /Button looks &lt;off&gt;/);

  ({ fetcher, batches } = fakeResend());
  await emailNewComment({ handoffId: "h", versionId: "v2", commentId: "c2", body: "Agreed", authorEmail: "Devin@lmf.ventures", isReply: true }, fetcher);
  assert.deepEqual(batches[0].map((email) => email.to[0]).sort(), ["dee@lmf.ventures", "pat@lmf.ventures"]);
  assert.equal(batches[0][0].subject, "devin@lmf.ventures replied on Rebooking");
});

test("a failing Resend call is logged, not thrown", async () => {
  enable();
  const result = await emailNewComment({ handoffId: "h", versionId: "v2", commentId: "c3", body: "x", authorId: "pd", isReply: false }, async () => new Response("bad", { status: 422 }));
  assert.equal(result.sent, 0);
  assert.match(renderEmail({ subject: "s", heading: "h", lines: [], buttonLabel: "Go", url: "https://x" }).text, /Go: https:\/\/x/);
});
