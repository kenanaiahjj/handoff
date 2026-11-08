import assert from "node:assert/strict";
import test from "node:test";
import { toMcpApprovedChangelog } from "./mcp-changelog.ts";

test("exposes approved changelog content and evidence without internal draft metadata", () => {
  const draft = {
    id: "approved-1",
    handoffId: "handoff-1",
    fromVersionId: "version-1",
    toVersionId: "version-2",
    title: "Updated booking flow",
    summary: "Clarified the add-ons step.",
    statements: [{ audience: "product", text: "Add-ons are clearer.", evidenceIds: ["change-1"] }],
    evidence: [{ id: "change-1", kind: "screen_change", content: "Button label changed." }],
    model: "Connected AI client",
    status: "approved",
    createdBy: "user-1",
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:05:00.000Z",
  };

  assert.deepEqual(toMcpApprovedChangelog(draft), {
    id: "approved-1",
    status: "approved",
    fromVersionId: "version-1",
    toVersionId: "version-2",
    title: "Updated booking flow",
    summary: "Clarified the add-ons step.",
    statements: draft.statements,
    evidence: draft.evidence,
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:05:00.000Z",
  });
});
