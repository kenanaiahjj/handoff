import assert from "node:assert/strict";
import test from "node:test";
import { resolveFrameReplacementMatches } from "./frame-replacements.ts";

const directMatch = {
  baselineVersionId: "v1",
  newVersionId: "v3",
  beforeFrameId: "old-frame",
  afterFrameId: "new-frame",
};

function resolve({ fromVersionId, toVersionId, fromFrameIds, toFrameIds, replacements }) {
  return resolveFrameReplacementMatches({
    versionIds: ["v1", "v2", "v3"],
    fromVersionId,
    toVersionId,
    fromFrameIds,
    toFrameIds,
    fromSourceFileId: "same-file",
    toSourceFileId: "same-file",
    replacements,
  });
}

test("uses a direct match for a non-adjacent version pair", () => {
  assert.deepEqual(resolve({
    fromVersionId: "v1",
    toVersionId: "v3",
    fromFrameIds: ["old-frame"],
    toFrameIds: ["new-frame"],
    replacements: [directMatch],
  }), [{ beforeFrameId: "old-frame", afterFrameId: "new-frame" }]);
});

test("reverses a direct match when comparing the pair in reverse", () => {
  assert.deepEqual(resolve({
    fromVersionId: "v3",
    toVersionId: "v1",
    fromFrameIds: ["new-frame"],
    toFrameIds: ["old-frame"],
    replacements: [directMatch],
  }), [{ beforeFrameId: "new-frame", afterFrameId: "old-frame" }]);
});

test("prefers a direct pair confirmation over an adjacent mapping chain", () => {
  const replacements = [
    { baselineVersionId: "v1", newVersionId: "v2", beforeFrameId: "old-frame", afterFrameId: "middle-frame" },
    { baselineVersionId: "v2", newVersionId: "v3", beforeFrameId: "middle-frame", afterFrameId: "chain-frame" },
    { baselineVersionId: "v1", newVersionId: "v3", beforeFrameId: "old-frame", afterFrameId: "direct-frame" },
  ];

  assert.deepEqual(resolve({
    fromVersionId: "v1",
    toVersionId: "v3",
    fromFrameIds: ["old-frame"],
    toFrameIds: ["chain-frame", "direct-frame"],
    replacements,
  }), [{ beforeFrameId: "old-frame", afterFrameId: "direct-frame" }]);
});

test("composes adjacent matches in either comparison direction", () => {
  const replacements = [
    { baselineVersionId: "v1", newVersionId: "v2", beforeFrameId: "old-frame", afterFrameId: "middle-frame" },
    { baselineVersionId: "v2", newVersionId: "v3", beforeFrameId: "middle-frame", afterFrameId: "new-frame" },
  ];

  assert.deepEqual(resolve({
    fromVersionId: "v1",
    toVersionId: "v3",
    fromFrameIds: ["old-frame"],
    toFrameIds: ["new-frame"],
    replacements,
  }), [{ beforeFrameId: "old-frame", afterFrameId: "new-frame" }]);
  assert.deepEqual(resolve({
    fromVersionId: "v3",
    toVersionId: "v1",
    fromFrameIds: ["new-frame"],
    toFrameIds: ["old-frame"],
    replacements,
  }), [{ beforeFrameId: "new-frame", afterFrameId: "old-frame" }]);
});

test("keeps identity matches across copied source files and ignores missing targets", () => {
  assert.deepEqual(resolveFrameReplacementMatches({
    versionIds: ["v1", "v2"],
    fromVersionId: "v1",
    toVersionId: "v2",
    fromFrameIds: ["same-frame", "removed-frame"],
    toFrameIds: ["same-frame"],
    fromSourceFileId: "file-copy-a",
    toSourceFileId: "file-copy-b",
    replacements: [],
  }), [{ beforeFrameId: "same-frame", afterFrameId: "same-frame" }]);
});
