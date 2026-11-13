import assert from "node:assert/strict";
import test from "node:test";
import { captureScopeNotice, comparisonChangeLabel, comparisonFrameStatusLabel } from "./compare-presentation.ts";
import * as comparePresentation from "./compare-presentation.ts";

test("labels capture coverage with the snapshot side, not as a screen change", () => {
  assert.equal(typeof comparePresentation.captureCoverageAvailabilityLabel, "function");
  assert.equal(comparePresentation.captureCoverageAvailabilityLabel("before"), "Before capture only");
  assert.equal(comparePresentation.captureCoverageAvailabilityLabel("after"), "After capture only");
});

test("explains how different capture scopes affect screen additions and removals", () => {
  assert.equal(
    captureScopeNotice({
      status: "different",
      before: "Selected frames and components",
      after: "All top-level frames and components on the current page",
    }),
    "Figma capture scopes differ. Before: Selected frames and components. After: All top-level frames and components on the current page. Screens shown on only one side may be outside the other capture's scope.",
  );
});

test("warns when one or both Figma capture scopes are missing", () => {
  assert.equal(
    captureScopeNotice({ status: "unrecorded", before: null, after: "Selected frames and components" }),
    "Figma capture scope is missing for one or both versions. Treat screens shown on only one side as unconfirmed changes.",
  );
});

test("labels one-sided screens by the capture that contains them", () => {
  assert.equal(comparisonFrameStatusLabel("only-in-before-capture"), "Present only in before capture");
  assert.equal(comparisonFrameStatusLabel("only-in-after-capture"), "Present only in after capture");
  assert.equal(comparisonFrameStatusLabel("unchanged"), "No changes");
  assert.equal(comparisonFrameStatusLabel("removed"), "Removed");
  assert.equal(comparisonFrameStatusLabel("added"), "New");
});

test("labels token binding identity and meaning fields separately", () => {
  const binding = 'tokens["color:fills[0]"]';

  assert.equal(comparisonChangeLabel({ path: `${binding}.sourceId` }), "Bound token ID");
  assert.equal(comparisonChangeLabel({ path: `${binding}.collectionId` }), "Collection ID");
  assert.equal(comparisonChangeLabel({ path: `${binding}.collectionName` }), "Collection");
  assert.equal(comparisonChangeLabel({ path: `${binding}.category` }), "Token type");
  assert.equal(comparisonChangeLabel({ path: `${binding}.name` }), "Token name");
  assert.equal(comparisonChangeLabel({ path: `${binding}.mode` }), "Mode");
  assert.equal(comparisonChangeLabel({ path: `${binding}.value` }), "Resolved value");
  assert.equal(comparisonChangeLabel({ path: `${binding}.value.r` }), "Resolved value");
});

test("labels Figma-native geometry changes explicitly", () => {
  assert.equal(comparisonChangeLabel({ path: "layoutBounds.x.value" }), "Figma X");
  assert.equal(comparisonChangeLabel({ path: "layoutBounds.y.value" }), "Figma Y");
  assert.equal(comparisonChangeLabel({ path: "layoutBounds.width.value" }), "Figma width");
  assert.equal(comparisonChangeLabel({ path: "layoutBounds.height.value" }), "Figma height");
});

test("explains one-sided frames when selected capture scopes have the same label", () => {
  assert.equal(
    captureScopeNotice(null, true),
    "Screens present in only one capture are not confirmed design additions or removals.",
  );
});
