import assert from "node:assert/strict";
import test from "node:test";
import { findReusableAsset } from "./reusable-assets.ts";

const captured = {
  key: "capture-frame",
  fileName: "frame.png",
  contentType: "image/png",
  sizeBytes: 2048,
  sha256: "a".repeat(64),
  width: 390,
  height: 844,
};

test("does not reuse same-byte assets when file name or dimensions differ", () => {
  const candidates = [
    { ...captured, fileName: "previous-frame.png", objectKey: "name-mismatch" },
    { ...captured, width: 400, objectKey: "width-mismatch" },
    { ...captured, height: 900, objectKey: "height-mismatch" },
  ];

  assert.equal(findReusableAsset(captured, candidates), undefined);
});

test("reuses an asset when all stored metadata matches", () => {
  const candidate = { ...captured, objectKey: "matching-baseline-object" };

  assert.equal(findReusableAsset(captured, [candidate]), candidate);
});
