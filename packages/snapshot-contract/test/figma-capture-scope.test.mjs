import assert from "node:assert/strict";
import test from "node:test";
import { formatFigmaCaptureScope } from "../src/figma-capture-scope.ts";

test("formats each Figma capture scope with an explicit label", () => {
  assert.equal(formatFigmaCaptureScope("selected"), "Selected frames and components");
  assert.equal(formatFigmaCaptureScope("page"), "All top-level frames and components on the current page");
  assert.equal(formatFigmaCaptureScope("file"), "All top-level frames and components across all pages");
});

test("formats the capture-scope metadata already stored in snapshots", () => {
  assert.equal(formatFigmaCaptureScope("selected frames and components"), "Selected frames and components");
  assert.equal(formatFigmaCaptureScope("all top-level frames and components on current page"), "All top-level frames and components on the current page");
  assert.equal(formatFigmaCaptureScope("all top-level frames and components across all pages"), "All top-level frames and components across all pages");
});

test("preserves an unknown scope description and ignores missing values", () => {
  assert.equal(formatFigmaCaptureScope("Entire project workspace"), "Entire project workspace");
  assert.equal(formatFigmaCaptureScope("   "), null);
  assert.equal(formatFigmaCaptureScope(null), null);
});
