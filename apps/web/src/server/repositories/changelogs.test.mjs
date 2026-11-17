import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createPostgresTestFixture } from "../test-support/postgres-test-fixture.mjs";
import {
  createChangelogDraft,
  getChangelogDraft,
  listApprovedChangelogsForVersion,
  updateChangelogDraft,
} from "./changelogs.ts";

const fixture = await createPostgresTestFixture();
const { pool } = fixture;

await pool.query(`
  CREATE TABLE changelog_draft (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    handoff_id TEXT NOT NULL,
    from_version_id TEXT NOT NULL,
    to_version_id TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    statements_json TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    model_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

after(async () => fixture.close());

test("editing and approving a changelog preserves its version pair and source evidence", async () => {
  const evidence = [{
    id: "diff:file-1:screen-checkout:button-primary:sourcePayload.textSegments.0.characters",
    kind: "diff",
    label: "Checkout · text · button label",
    details: "Text change from Continue to Book now.",
    versionId: "version-after",
    frameId: "screen-checkout",
    sourceNodeId: "button-primary",
    path: "sourcePayload.textSegments.0.characters",
  }];
  const draft = await createChangelogDraft({
    workspaceId: "workspace-1",
    handoffId: "handoff-1",
    fromVersionId: "version-before",
    toVersionId: "version-after",
    title: "Checkout update",
    summary: "The primary action changed.",
    statements: [{ audience: "developer", text: "The CTA says Book now.", evidence: [evidence[0].id] }],
    evidence,
    model: "local-test-model",
    createdBy: "designer-1",
  });

  assert.equal(await updateChangelogDraft({
    workspaceId: "workspace-1",
    handoffId: "handoff-1",
    draftId: draft.id,
    title: "Checkout action update",
    summary: "The primary action now guides the next step.",
    statements: [{ audience: "product", text: "The checkout action now says Book now.", evidence: [evidence[0].id] }],
    status: "approved",
  }), true);

  const saved = await getChangelogDraft({ workspaceId: "workspace-1", handoffId: "handoff-1", draftId: draft.id });
  assert.equal(saved.status, "approved");
  assert.equal(saved.title, "Checkout action update");
  assert.equal(saved.summary, "The primary action now guides the next step.");
  assert.deepEqual(saved.statements, [{ audience: "product", text: "The checkout action now says Book now.", evidence: [evidence[0].id] }]);
  assert.deepEqual(saved.evidence, evidence);
  assert.equal(saved.fromVersionId, "version-before");
  assert.equal(saved.toVersionId, "version-after");
  assert.deepEqual(
    (await listApprovedChangelogsForVersion({ workspaceId: "workspace-1", handoffId: "handoff-1", versionId: "version-after" })).map(({ id }) => id),
    [draft.id],
  );
});
