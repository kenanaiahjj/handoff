import assert from "node:assert/strict";
import test from "node:test";
import {
  comparisonChangeLabel,
  comparisonValueLabel,
  countComparisonChangesByCategory,
  formatComparisonChangeCount,
  groupComparisonChanges,
  separateSupplementalChanges,
} from "./compare-presentation.ts";
import { formatComparisonValue } from "./format-captured-measurement.ts";
import * as comparePresentation from "./compare-presentation.ts";

test("groups captured changes by named element and keeps screen-level changes separate", () => {
  const changes = [
    {
      frameId: "frame-1",
      sourceNodeId: "node-1",
      sourceNodeName: "Passenger name input",
      path: "bounds.width",
      before: { value: 393, unit: "px" },
      after: { value: 320, unit: "px" },
      category: "geometry",
    },
    {
      frameId: "frame-1",
      sourceNodeId: "node-1",
      sourceNodeName: "Passenger name input",
      path: "padding.left",
      before: { value: 16, unit: "px" },
      after: { value: 24, unit: "px" },
      category: "layout",
    },
    {
      frameId: "frame-1",
      sourceNodeId: null,
      sourceNodeName: null,
      path: "renderAsset",
      before: { sha256: "before" },
      after: { sha256: "after" },
      category: "visual",
    },
  ];

  const groups = groupComparisonChanges(changes, "Passenger details");

  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, "Passenger name input");
  assert.equal(groups[0].changes.length, 2);
  assert.equal(groups[1].label, "Passenger details");
  assert.equal(groups[1].changes[0].path, "renderAsset");
});

test("labels common captured properties in plain language", () => {
  assert.equal(comparisonChangeLabel({ path: "bounds.width", category: "geometry" }), "Width");
  assert.equal(comparisonChangeLabel({ path: "padding.left", category: "layout" }), "Left padding");
  assert.equal(comparisonChangeLabel({ path: "margins.top", category: "layout" }), "Top margin");
  assert.equal(comparisonChangeLabel({ path: "fills[0].color", category: "style" }), "Fill color");
  assert.equal(comparisonChangeLabel({ path: "fills[0]", category: "style" }), "Fill");
  assert.equal(comparisonChangeLabel({ path: "sourcePayload.textSegments[0].characters", category: "text" }), "Text content");
  assert.equal(comparisonChangeLabel({ path: "sourcePayload.fillPaintDetails[0].color.g", category: "structure" }), "Fill color");
  assert.equal(comparisonChangeLabel({ path: "typography.fontSize", category: "style" }), "Font size");
  assert.equal(comparisonChangeLabel({ path: "tokens[\"color.primary\"]", category: "token" }), "Token binding");
  assert.equal(comparisonChangeLabel({ path: "renderAsset", category: "visual" }), "Screen render");
});

test("shows the total change count with its visual and captured breakdown", () => {
  assert.equal(formatComparisonChangeCount(62, 4), "62 total changes (58 captured, 4 visual differences)");
  assert.equal(formatComparisonChangeCount(1, 1), "1 total change (1 visual difference)");
  assert.equal(formatComparisonChangeCount(3, 0), "3 total changes (3 captured)");
});

test("explains inferred or different source identities in a comparison", () => {
  const sourceIdentityNotice = comparePresentation.sourceIdentityNotice;
  assert.equal(typeof sourceIdentityNotice, "function");
  assert.equal(sourceIdentityNotice("exact"), null);
  assert.equal(
    sourceIdentityNotice("inferred"),
    "At least one snapshot has a legacy Figma file ID. The source file identity cannot be verified.",
  );
  assert.match(sourceIdentityNotice("different"), /different Figma file IDs/);
});

test("counts categories within the selected screen", () => {
  const changes = [
    { frameId: "screen-a", category: "geometry" },
    { frameId: "screen-a", category: "layout" },
    { frameId: "screen-a", category: "visual" },
    { frameId: "screen-b", category: "geometry" },
    { frameId: "screen-b", category: "geometry" },
    { frameId: "screen-b", category: "structure" },
  ];

  assert.deepEqual(countComparisonChangesByCategory(changes, "screen-a"), {
    geometry: 1,
    layout: 1,
    style: 0,
    text: 0,
    token: 0,
    structure: 0,
    visual: 1,
  });
});

test("separates duplicate raw paint capture fields from visible design changes", () => {
  const visible = { path: "fills[0].color", category: "style" };
  const fillCapture = { path: "sourcePayload.fillPaintDetails[0].color.g", category: "structure" };
  const strokeCapture = { path: "sourcePayload.strokePaintDetails[0].color.r", category: "structure" };
  const textCapture = { path: "sourcePayload.textSegments[0].characters", category: "text" };
  const separated = separateSupplementalChanges([visible, fillCapture, strokeCapture, textCapture]);

  assert.deepEqual(separated.visible, [visible, textCapture]);
  assert.deepEqual(separated.supplemental, [fillCapture, strokeCapture]);
});

test("summarizes added and removed layers without exposing their full captured payload", () => {
  const added = {
    path: "node",
    before: undefined,
    after: { sourceNodeId: "node-2", name: "New badge", sourcePayload: { arbitrary: "capture data" } },
    category: "structure",
  };
  const removed = {
    path: "node",
    before: { sourceNodeId: "node-3", name: "Old badge", sourcePayload: { arbitrary: "capture data" } },
    after: undefined,
    category: "structure",
  };

  assert.equal(comparisonValueLabel(added, "before", formatComparisonValue), "Not present");
  assert.equal(comparisonValueLabel(added, "after", formatComparisonValue), "Added");
  assert.equal(comparisonValueLabel(removed, "before", formatComparisonValue), "Removed");
  assert.equal(comparisonValueLabel(removed, "after", formatComparisonValue), "Not present");
});

test("summarizes added and removed screens without exposing their captured payload", () => {
  const added = {
    path: "frame",
    before: undefined,
    after: { sourceFrameId: "frame-2", name: "Review" },
    category: "structure",
  };
  const removed = {
    path: "frame",
    before: { sourceFrameId: "frame-1", name: "Review" },
    after: undefined,
    category: "structure",
  };

  assert.equal(comparisonChangeLabel(added), "Screen");
  assert.equal(comparisonValueLabel(added, "before", formatComparisonValue), "Not present");
  assert.equal(comparisonValueLabel(added, "after", formatComparisonValue), "Added");
  assert.equal(comparisonValueLabel(removed, "before", formatComparisonValue), "Removed");
  assert.equal(comparisonValueLabel(removed, "after", formatComparisonValue), "Not present");
});
