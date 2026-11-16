import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test, { after } from "node:test";
import {
  createFindingComment,
  listFindingComments,
  listFindingStates,
  saveFindingState,
} from "./findings.ts";

const priorDatabase = globalThis.__asbirDatabase;
const database = new Database(":memory:");
globalThis.__asbirDatabase = database;

database.exec(`
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE layout_finding_state (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    handoff_version_id TEXT NOT NULL,
    finding_key TEXT NOT NULL,
    status TEXT NOT NULL,
    assignee_user_id TEXT,
    note TEXT,
    updated_by_user_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (handoff_version_id, finding_key)
  );
  CREATE TABLE layout_finding_comment (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    handoff_version_id TEXT NOT NULL,
    finding_key TEXT NOT NULL,
    author_user_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);
database.prepare('INSERT INTO "user" (id, name) VALUES (?, ?)').run("qa-user", "QA reviewer");

after(() => {
  database.close();
  globalThis.__asbirDatabase = priorDatabase;
});

test("finding state and comments are isolated by immutable version", () => {
  const workspaceId = "workspace-a";
  const findingKey = "spacing:screen-a:button:padding.top";

  saveFindingState({
    workspaceId,
    versionId: "version-before",
    findingKey,
    status: "resolved",
    assigneeUserId: "qa-user",
    note: "Accepted in the original handoff.",
    updatedBy: "designer-user",
  });
  saveFindingState({
    workspaceId,
    versionId: "version-after",
    findingKey,
    status: "open",
    assigneeUserId: null,
    note: "Recheck after the layout change.",
    updatedBy: "designer-user",
  });
  saveFindingState({
    workspaceId,
    versionId: "version-before",
    findingKey,
    status: "resolved",
    assigneeUserId: "qa-user",
    note: "Approved in the original handoff.",
    updatedBy: "qa-user",
  });
  createFindingComment({
    workspaceId,
    versionId: "version-before",
    findingKey,
    authorUserId: "qa-user",
    body: "Reviewed in the original handoff.",
  });
  createFindingComment({
    workspaceId,
    versionId: "version-after",
    findingKey,
    authorUserId: "qa-user",
    body: "Recheck after the layout change.",
  });

  assert.deepEqual(
    listFindingStates({ workspaceId, versionId: "version-before" }).map(({ findingKey: key, status, note }) => ({ key, status, note })),
    [{ key: findingKey, status: "resolved", note: "Approved in the original handoff." }],
  );
  assert.deepEqual(
    listFindingStates({ workspaceId, versionId: "version-after" }).map(({ findingKey: key, status, note }) => ({ key, status, note })),
    [{ key: findingKey, status: "open", note: "Recheck after the layout change." }],
  );
  assert.deepEqual(
    listFindingComments({ workspaceId, versionId: "version-before" }).map(({ findingKey: key, authorName, body }) => ({ key, authorName, body })),
    [{ key: findingKey, authorName: "QA reviewer", body: "Reviewed in the original handoff." }],
  );
  assert.deepEqual(
    listFindingComments({ workspaceId, versionId: "version-after" }).map(({ findingKey: key, authorName, body }) => ({ key, authorName, body })),
    [{ key: findingKey, authorName: "QA reviewer", body: "Recheck after the layout change." }],
  );
});
