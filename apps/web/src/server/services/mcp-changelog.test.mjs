import assert from "node:assert/strict";
import test from "node:test";
import { collectChangelogEvidence, createEvidenceLinkedDraft } from "../ai/draft-changelog.ts";
import { toMcpApprovedChangelog } from "./mcp-changelog.ts";

function syntheticSnapshot(text) {
  const measurement = (value, sourceProperty) => ({ value, unit: "px", provenance: "source", sourceProperty });
  const bounds = {
    x: measurement(0, "x"),
    y: measurement(0, "y"),
    width: measurement(320, "width"),
    height: measurement(640, "height"),
  };
  return {
    sourceFileId: "file-synthetic",
    frames: [{
      sourceFrameId: "frame-checkout",
      sourcePageId: "page-main",
      name: "Checkout",
      bounds,
      renderAssetKey: "render",
      nodes: [{
        sourceNodeId: "node-title",
        name: "Title",
        type: "TEXT",
        fills: [],
        strokes: [],
        styleReferences: [],
        tokens: [],
        sourcePayload: { textSegments: [{ characters: text }] },
      }],
    }],
    assets: [{ key: "render", sha256: "b".repeat(64) }],
  };
}

function manyScreenSnapshot(text) {
  const base = syntheticSnapshot(text);
  const template = base.frames[0];
  const frames = Array.from({ length: 210 }, (_, index) => ({
    ...structuredClone(template),
    sourceFrameId: `frame-${index}`,
    name: `Screen ${index}`,
    renderAssetKey: `render-${index}`,
    nodes: template.nodes.map((node) => ({
      ...structuredClone(node),
      sourceNodeId: `${node.sourceNodeId}-${index}`,
      sourceFrameId: `frame-${index}`,
    })),
  }));
  return {
    ...base,
    frames,
    assets: frames.map((frame, index) => ({ key: frame.renderAssetKey, sha256: `render-${index}` })),
  };
}

const noLayoutRules = {
  allowedSpacing: [],
  requireTokenCategories: [],
  frameBounds: null,
};

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

test("links an AI-authored draft to evidence generated from its exact version pair", async () => {
  const draft = await createEvidenceLinkedDraft({
    workspaceId: "workspace-synthetic",
    handoffId: "handoff-synthetic",
    handoffName: "Synthetic checkout",
    from: { id: "version-before", versionLabel: "Before", snapshot: syntheticSnapshot("Review") },
    to: { id: "version-after", versionLabel: "After", snapshot: syntheticSnapshot("Review your booking") },
    rules: noLayoutRules,
  }, {
    listComments: () => [],
    generateChangelog: async ({ evidence }) => {
      const textEvidence = evidence.find((item) => item.kind === "diff" && item.label.includes("characters"));
      assert.ok(textEvidence, "the version pair should produce text-change evidence");
      return {
        model: "Synthetic test model",
        content: {
          title: "Checkout copy updated",
          summary: "The review screen now clarifies the booking action.",
          statements: [{ audience: "product", text: "The title clarifies the booking action.", evidence: [textEvidence.id] }],
        },
      };
    },
  });

  assert.equal(draft.model, "Synthetic test model");
  assert.deepEqual(draft.evidence.map((item) => ({ id: item.id, versionId: item.versionId, path: item.path })), [
    { id: draft.statements[0].evidence[0], versionId: "version-after", path: "sourcePayload.textSegments[0].characters" },
  ]);
});

test("uses reviewer-confirmed layer matches when building changelog evidence", () => {
  const before = syntheticSnapshot("Review booking");
  before.frames[0].nodes[0].sourceNodeId = "node-before";
  const after = syntheticSnapshot("Review your booking");
  after.frames[0].nodes[0].sourceNodeId = "node-after";
  after.frames[0].nodes[0].name = "Page title";

  const evidence = collectChangelogEvidence({
    workspaceId: "workspace-synthetic",
    handoffId: "handoff-synthetic",
    from: { id: "version-before", versionLabel: "Before", snapshot: before },
    to: { id: "version-after", versionLabel: "After", snapshot: after },
    rules: noLayoutRules,
    nodeMatches: [{
      beforeFrameId: "frame-checkout",
      afterFrameId: "frame-checkout",
      beforeNodeId: "node-before",
      afterNodeId: "node-after",
    }],
  }, () => []);

  assert.equal(evidence.some((item) => item.kind === "diff" && item.path === "node"), false);
  assert.equal(evidence.some((item) => item.kind === "diff" && item.path === "name"), true);
  assert.equal(evidence.some((item) => item.kind === "diff" && item.path === "sourcePayload.textSegments[0].characters"), true);
});

test("rejects AI statements that cite evidence outside the supplied version pair", async () => {
  await assert.rejects(() => createEvidenceLinkedDraft({
    workspaceId: "workspace-synthetic",
    handoffId: "handoff-synthetic",
    handoffName: "Synthetic checkout",
    from: { id: "version-before", versionLabel: "Before", snapshot: syntheticSnapshot("Review") },
    to: { id: "version-after", versionLabel: "After", snapshot: syntheticSnapshot("Review your booking") },
    rules: noLayoutRules,
  }, {
    listComments: () => [],
    generateChangelog: async () => ({
      model: "Synthetic test model",
      content: {
        title: "Unsupported statement",
        summary: "This draft cites a fabricated ID.",
        statements: [{ audience: "qa", text: "Unsupported claim.", evidence: ["fabricated-evidence"] }],
      },
    }),
  }), /referenced evidence that was not part of this handoff/);
});

test("does not present one-sided selected screens to AI as design additions or removals", () => {
  const before = syntheticSnapshot("Review");
  before.source = "figma";
  before.sourceMetadata = { captureScope: "selected frames and components", sourcePageId: "page-main" };
  before.frames[0].sourceFrameId = "screen-before";
  before.frames[0].nodes[0].sourceFrameId = "screen-before";
  const after = syntheticSnapshot("Review");
  after.source = "figma";
  after.sourceMetadata = { captureScope: "selected frames and components", sourcePageId: "page-main" };
  after.frames[0].sourceFrameId = "screen-after";
  after.frames[0].nodes[0].sourceFrameId = "screen-after";

  const evidence = collectChangelogEvidence({
    workspaceId: "workspace-synthetic",
    handoffId: "handoff-synthetic",
    from: { id: "version-before", versionLabel: "Before", snapshot: before },
    to: { id: "version-after", versionLabel: "After", snapshot: after },
    rules: noLayoutRules,
  }, () => []);

  assert.deepEqual(evidence.filter((item) => item.kind === "frame"), []);
});

test("keeps exact diff evidence in the AI input for a 210-screen comparison", () => {
  const evidence = collectChangelogEvidence({
    workspaceId: "workspace-synthetic",
    handoffId: "handoff-synthetic",
    from: { id: "version-before", versionLabel: "Before", snapshot: manyScreenSnapshot("Review") },
    to: { id: "version-after", versionLabel: "After", snapshot: manyScreenSnapshot("Review your booking") },
    rules: noLayoutRules,
  }, () => []);

  assert.ok(evidence.length <= 200);
  assert.ok(evidence.some((item) => item.kind === "diff" && item.path === "sourcePayload.textSegments[0].characters"));
});
