import assert from "node:assert/strict";
import test from "node:test";
import { resolveNodeReplacementMatches } from "./node-replacements.ts";

const directMatch = {
  baselineVersionId: "v1",
  newVersionId: "v3",
  beforeFrameId: "frame-before",
  afterFrameId: "frame-after",
  beforeNodeId: "node-before",
  afterNodeId: "node-after",
};

test("uses a saved node match for its version pair in either comparison direction", () => {
  const input = {
    versionIds: ["v1", "v2", "v3"],
    replacements: [directMatch],
  };

  assert.deepEqual(resolveNodeReplacementMatches({
    ...input,
    fromVersionId: "v1",
    toVersionId: "v3",
  }), [{
    beforeFrameId: "frame-before",
    afterFrameId: "frame-after",
    beforeNodeId: "node-before",
    afterNodeId: "node-after",
  }]);
  assert.deepEqual(resolveNodeReplacementMatches({
    ...input,
    fromVersionId: "v3",
    toVersionId: "v1",
  }), [{
    beforeFrameId: "frame-after",
    afterFrameId: "frame-before",
    beforeNodeId: "node-after",
    afterNodeId: "node-before",
  }]);
});

test("does not reuse a node match confirmed for another version pair", () => {
  assert.deepEqual(resolveNodeReplacementMatches({
    versionIds: ["v1", "v2", "v3"],
    fromVersionId: "v2",
    toVersionId: "v3",
    replacements: [directMatch],
  }), []);
});
