import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";

const fixture = await createPostgresTestFixture();
const { database, pool } = fixture;

await pool.query(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT, email TEXT, image TEXT);
  CREATE TABLE IF NOT EXISTS user_presence (user_id TEXT PRIMARY KEY, last_seen_at TIMESTAMPTZ);
  CREATE TABLE workspace_membership (workspace_id TEXT, user_id TEXT, role TEXT);
  CREATE TABLE project (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, pd_in_charge_user_id TEXT);
  CREATE TABLE handoff (id TEXT PRIMARY KEY, workspace_id TEXT, project_id TEXT, name TEXT);
  CREATE TABLE handoff_invite (id TEXT, workspace_id TEXT, handoff_id TEXT, email TEXT, revoked_at TEXT, expires_at TEXT);
  CREATE TABLE IF NOT EXISTS project_member (project_id TEXT, workspace_id TEXT, email TEXT, role TEXT, added_by_user_id TEXT, created_at TEXT);
  CREATE TABLE handoff_comment (id TEXT PRIMARY KEY, handoff_version_id TEXT, frame_id TEXT, body TEXT, created_by_user_id TEXT,
    author_label TEXT, resolved_at TEXT);
  CREATE TABLE comment_mention (comment_id TEXT, user_id TEXT, workspace_id TEXT, handoff_id TEXT, thread_id TEXT,
    mentioned_by_user_id TEXT, created_at TEXT, done_at TEXT, PRIMARY KEY (comment_id, user_id));
`);
await database.prepare(`INSERT INTO "user" VALUES ('owner', 'Olive Owner', 'olive@lmf.ventures'), ('riley', 'Riley Reviewer', 'riley@lmf.ventures'), ('sam', 'Sam Outsider', 'sam@lmf.ventures')`).run();
await database.prepare("INSERT INTO workspace_membership VALUES ('ws', 'owner', 'owner'), ('ws', 'riley', 'reviewer'), ('ws', 'sam', 'reviewer')").run();
await database.prepare("INSERT INTO project VALUES ('p', 'ws', 'Maayo', NULL)").run();
await database.prepare("INSERT INTO handoff VALUES ('h', 'ws', 'p', 'Rebooking')").run();
// Riley can see the handoff; Sam can't.
await database.prepare("INSERT INTO handoff_invite VALUES ('i', 'ws', 'h', 'riley@lmf.ventures', NULL, NULL)").run();

const { listMentionables, listOpenMentions, markMentionDone, mentionedUserIds, plainCommentText, recordCommentMentions } = await import("./mentions.ts");

after(async () => fixture.close());

async function comment(id, body, author, parent = null) {
  await database.prepare("INSERT INTO handoff_comment VALUES (?, 'v', 'f', ?, ?, NULL, NULL)").run(id, body, author);
  return recordCommentMentions({ workspaceId: "ws", handoffId: "h", commentId: id, threadId: parent ?? id, authorId: author, body });
}

const riley = { id: "riley", email: "riley@lmf.ventures", role: "reviewer" };

test("mention tokens are parsed and shown as @Name", () => {
  const body = "Hey @[Riley Reviewer](user:riley) can you check?";
  assert.deepEqual(mentionedUserIds(body), ["riley"]);
  assert.equal(plainCommentText(body), "Hey @Riley Reviewer can you check?");
});

test("only people who can see the handoff can be mentioned", async () => {
  assert.deepEqual((await listMentionables("ws", "h")).map((person) => person.id).sort(), ["owner", "riley"]);
  const mentioned = await comment("c1", "@[Riley Reviewer](user:riley) and @[Sam Outsider](user:sam)", "owner");
  assert.deepEqual(mentioned.map((person) => person.id), ["riley"]);
});

test("an open mention shows in Needs you until the person replies, the thread resolves, or they mark it done", async () => {
  assert.deepEqual((await listOpenMentions("riley", "ws", riley)).map((mention) => mention.commentId), ["c1"]);
  assert.equal((await listOpenMentions("riley", "ws", riley))[0].excerpt, "@Riley Reviewer and @Sam Outsider");

  await comment("c2", "On it", "riley", "c1");
  assert.deepEqual(await listOpenMentions("riley", "ws", riley), []);

  await comment("c3", "One more @[Riley Reviewer](user:riley)", "owner", "c1");
  assert.equal((await listOpenMentions("riley", "ws", riley)).length, 1);
  assert.equal(await markMentionDone("riley", "c3"), true);
  assert.deepEqual(await listOpenMentions("riley", "ws", riley), []);

  await comment("c4", "New thread @[Riley Reviewer](user:riley)", "owner");
  await database.prepare("UPDATE handoff_comment SET resolved_at = 'now' WHERE id = 'c4'").run();
  assert.deepEqual(await listOpenMentions("riley", "ws", riley), []);
});
