import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";

const priorToken = process.env.SLACK_BOT_TOKEN;
const fixture = await createPostgresTestFixture();
const { database, pool } = fixture;

await pool.query(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT, email TEXT);
  CREATE TABLE IF NOT EXISTS user_presence (user_id TEXT PRIMARY KEY, last_seen_at TIMESTAMPTZ);
  CREATE TABLE workspace_membership (workspace_id TEXT, user_id TEXT, role TEXT);
  CREATE TABLE project (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, pd_in_charge_user_id TEXT);
  CREATE TABLE handoff (id TEXT PRIMARY KEY, workspace_id TEXT, project_id TEXT, name TEXT);
  CREATE TABLE handoff_invite (id TEXT, workspace_id TEXT, handoff_id TEXT, email TEXT, revoked_at TEXT, expires_at TEXT);
  CREATE TABLE IF NOT EXISTS project_member (project_id TEXT, workspace_id TEXT, email TEXT, role TEXT, added_by_user_id TEXT, created_at TEXT);
  CREATE TABLE viewer_pin (user_id TEXT, kind TEXT, target_id TEXT, created_at TEXT);
  CREATE TABLE handoff_version (id TEXT PRIMARY KEY, handoff_id TEXT, version_label TEXT, created_by_user_id TEXT, created_at TEXT, snapshot_json TEXT);
  CREATE TABLE IF NOT EXISTS handoff_version_snapshot (version_id TEXT PRIMARY KEY, encoding TEXT NOT NULL, compressed BYTEA NOT NULL, raw_bytes INTEGER NOT NULL, frame_index TEXT NOT NULL);
  CREATE TABLE handoff_asset (handoff_version_id TEXT, asset_key TEXT, object_key TEXT);
  CREATE TABLE notification_preference (user_id TEXT PRIMARY KEY, slack TEXT NOT NULL DEFAULT 'all' CHECK (slack IN ('all', 'mentions', 'off')), updated_at TEXT NOT NULL);
`);
await database.prepare(`INSERT INTO "user" VALUES ('designer', 'Dee Designer', 'dee@lmf.ventures'), ('pd', 'Pat Lead', 'pat@lmf.ventures'), ('fan', 'Fay Follower', 'fay@lmf.ventures')`).run();
await database.prepare("INSERT INTO workspace_membership VALUES ('ws', 'designer', 'designer'), ('ws', 'pd', 'reviewer'), ('ws', 'fan', 'reviewer')").run();
await database.prepare("INSERT INTO project VALUES ('p', 'ws', 'Maayo', 'pd')").run();
await database.prepare("INSERT INTO handoff VALUES ('h', 'ws', 'p', 'Rebooking')").run();
await database.prepare("INSERT INTO handoff_invite VALUES ('i1', 'ws', 'h', 'qa@lmf.ventures', NULL, NULL), ('i2', 'ws', 'h', 'gone@lmf.ventures', 'revoked', NULL), ('i3', 'ws', 'h', 'dee@lmf.ventures', NULL, NULL)").run();
await database.prepare("INSERT INTO viewer_pin VALUES ('fan', 'project', 'p', 'now')").run();
const frames = (keys) => JSON.stringify({ frames: keys.map((key) => ({ sourceFrameId: key, name: key, renderAssetKey: key })) });
await database.prepare("INSERT INTO handoff_version VALUES ('v1', 'h', '1.0', 'designer', '2026-01-01', ?), ('v2', 'h', '1.1', 'designer', '2026-01-02', ?)").run(frames(["a", "b"]), frames(["a", "b", "c"]));
await database.prepare("INSERT INTO handoff_asset VALUES ('v1', 'a', 'x'), ('v1', 'b', 'y'), ('v2', 'a', 'x'), ('v2', 'b', 'y2'), ('v2', 'c', 'z')").run();

const { isSlackEnabled, newVersionRecipients, notifyMentions, notifyNewVersion } = await import("./slack.ts");

after(async () => {
  if (priorToken === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = priorToken;
  await fixture.close();
});

/** A fake Slack API: everyone except "nobody@" has an account; records each DM. */
function fakeSlack() {
  const messages = [];
  const fetcher = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("users.lookupByEmail")) {
      const email = parsed.searchParams.get("email");
      return Response.json(email.startsWith("nobody") ? { ok: false, error: "users_not_found" } : { ok: true, user: { id: `U-${email}` } });
    }
    messages.push(JSON.parse(init.body));
    return Response.json({ ok: true });
  };
  return { fetcher, messages };
}

test("does nothing until a Slack bot token is set", async () => {
  delete process.env.SLACK_BOT_TOKEN;
  assert.equal(isSlackEnabled(), false);
  const { fetcher, messages } = fakeSlack();
  assert.deepEqual(await notifyNewVersion({ workspaceId: "ws", handoffId: "h", versionId: "v2", createdBy: "designer" }, fetcher), { sent: 0 });
  assert.equal(messages.length, 0);
});

test("new versions reach invitees, the PD and people who pinned the project, never the publisher", async () => {
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  assert.deepEqual((await newVersionRecipients({ workspaceId: "ws", handoffId: "h", createdBy: "designer" })).sort(), ["fay@lmf.ventures", "pat@lmf.ventures", "qa@lmf.ventures"]);

  const { fetcher, messages } = fakeSlack();
  const result = await notifyNewVersion({ workspaceId: "ws", handoffId: "h", versionId: "v2", createdBy: "designer" }, fetcher);
  assert.equal(result.sent, 3);
  assert.match(messages[0].text, /\*Dee Designer\* published version \*1\.1\* of \*Rebooking\* in Maayo/);
  const section = messages[0].blocks[0].text.text;
  assert.match(section, /1 screen changed · 1 new/);
  const button = messages[0].blocks[1].elements[0];
  assert.equal(button.text.text, "Review changes");
  assert.match(button.url, /compareFrom=v1&compareTo=v2/);
});

test("mentions DM the person with the comment and a link to the thread", async () => {
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  const { fetcher, messages } = fakeSlack();
  const result = await notifyMentions(
    {
      workspaceId: "ws", handoffId: "h", versionId: "v2", commentId: "c1", authorId: "designer",
      body: "Can you check this @[Pat Lead](user:pd)?",
      mentioned: [{ email: "pat@lmf.ventures" }, { email: "nobody@lmf.ventures" }],
    },
    fetcher,
  );
  assert.equal(result.sent, 1);
  assert.equal(messages[0].channel, "U-pat@lmf.ventures");
  assert.match(messages[0].blocks[0].text.text, /Can you check this @Pat Lead\?/);
  assert.match(messages[0].blocks[1].elements[0].url, /comment=c1/);
});

test("each person's Slack setting filters who gets messaged", async () => {
  const { filterBySlackPreference, setSlackPreference, getSlackPreference } = await import("./notification-preferences.ts");
  const emails = ["dee@lmf.ventures", "pat@lmf.ventures", "fay@lmf.ventures", "outsider@lmf.ventures"];
  assert.equal(await getSlackPreference("pd"), "all");
  await setSlackPreference("pd", "mentions");
  await setSlackPreference("fan", "off");
  // Versions: only "all" (and people without an account) hear about them.
  assert.deepEqual(await filterBySlackPreference(emails, "version"), ["dee@lmf.ventures", "outsider@lmf.ventures"]);
  // Mentions: "mentions only" still gets them; "off" never does.
  assert.deepEqual(await filterBySlackPreference(emails, "mention"), ["dee@lmf.ventures", "pat@lmf.ventures", "outsider@lmf.ventures"]);
  await setSlackPreference("pd", "all");
  await setSlackPreference("fan", "all");
  assert.equal(await getSlackPreference("fan"), "all");
});
