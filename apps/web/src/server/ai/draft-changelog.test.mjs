import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceLinkedDraft } from "./draft-changelog.ts";

function snapshot(label, nodeCount = 1) {
  return {
    sourceFileId: "figma-file-1",
    frames: [{
      sourceFrameId: "screen-checkout",
      sourcePageId: "page-booking",
      name: "Checkout",
      renderAssetKey: "checkout-render",
      bounds: {
        width: { value: null, unit: "px", provenance: "unavailable", sourceProperty: null },
        height: { value: null, unit: "px", provenance: "unavailable", sourceProperty: null },
      },
      nodes: Array.from({ length: nodeCount }, (_, index) => ({
        sourceNodeId: nodeCount === 1 ? "button-primary" : `button-primary-${index}`,
        name: `Continue button ${index + 1}`,
        type: "TEXT",
        fills: [{ color: "#ffffff", sourceStyleId: "F:primary" }],
        strokes: [],
        styleReferences: [],
        tokens: [],
        sourcePayload: {
          textSegments: [{ textStyleId: "T:button", fillStyleId: "F:primary", characters: `${label} ${index + 1}` }],
          fillPaintDetails: [],
          strokePaintDetails: [],
        },
      })),
    }],
    assets: [{ key: "checkout-render", sha256: "same-render" }],
  };
}

const input = {
  workspaceId: "workspace-1",
  handoffId: "handoff-1",
  handoffName: "Tripket checkout",
  from: { id: "version-1", versionLabel: "Version 1", snapshot: snapshot("Continue") },
  to: { id: "version-2", versionLabel: "Version 2", snapshot: snapshot("Book now") },
  rules: { allowedSpacing: [], requireTokenCategories: [], frameBounds: null },
};

test("creates changelog evidence from exact diffs and comments on the after version", async () => {
  let modelInput;
  const draft = await createEvidenceLinkedDraft(input, {
    listComments: ({ versionId }) => versionId === "version-2" ? [{
      id: "comment-1",
      frameId: "screen-checkout",
      sourceNodeId: "button-primary",
      parentCommentId: null,
      body: "Make the primary action clear.",
      resolvedAt: null,
    }] : [],
    generateChangelog: async (value) => {
      modelInput = value;
      const diff = value.evidence.find((item) => item.kind === "diff");
      assert.ok(diff, "the model receives a structured diff");
      return {
        content: {
          title: "Checkout action updated",
          summary: "The primary action label changed.",
          statements: [{
            audience: "product",
            text: "The checkout action now says Book now.",
            evidence: [diff.id],
          }],
        },
        model: "local-test-model",
      };
    },
  });

  assert.equal(modelInput.fromVersionLabel, "Version 1");
  assert.equal(modelInput.toVersionLabel, "Version 2");
  assert.ok(modelInput.evidence.some((item) => item.kind === "comment" && item.details.includes("Make the primary action clear.")));
  assert.equal(draft.model, "local-test-model");
  assert.equal(draft.evidence.length, 1);
  assert.equal(draft.evidence[0].versionId, "version-2");
  assert.equal(draft.evidence[0].frameId, "screen-checkout");
  assert.equal(draft.evidence[0].sourceNodeId, "button-primary");
  assert.match(draft.evidence[0].details, /Continue|Book now/);
});

test("rejects a generated statement that cites evidence outside the supplied snapshot", async () => {
  await assert.rejects(
    createEvidenceLinkedDraft(input, {
      listComments: () => [],
      generateChangelog: async () => ({
        content: {
          title: "Unsupported claim",
          summary: "This claim has no supplied evidence.",
          statements: [{ audience: "qa", text: "The payment flow is secure.", evidence: ["missing-evidence-id"] }],
        },
        model: "local-test-model",
      }),
    }),
    /referenced evidence that was not part of this handoff/,
  );
});

test("reports when a high-change draft receives only a subset of the available evidence", async () => {
  const manyChanges = {
    ...input,
    from: { ...input.from, snapshot: snapshot("Continue", 205) },
    to: { ...input.to, snapshot: snapshot("Book now", 205) },
  };
  let modelInput;
  const draft = await createEvidenceLinkedDraft(manyChanges, {
    listComments: () => [],
    generateChangelog: async (value) => {
      modelInput = value;
      return {
        content: {
          title: "High-change draft",
          summary: "The sample captures a subset of changes.",
          statements: [{ audience: "developer", text: "Review the captured text changes.", evidence: [value.evidence[0].id] }],
        },
        model: "local-test-model",
      };
    },
  });

  assert.equal(modelInput.evidence.length, 200);
  assert.deepEqual(modelInput.evidenceCoverage, { provided: 200, total: 206 });
  assert.match(
    draft.summary,
    /Evidence coverage: this draft uses 200 of 206 available evidence items/,
  );
});
