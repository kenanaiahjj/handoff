import assert from "node:assert/strict";
import test from "node:test";
import { getVisibleLayoutGrids, hasVisibleLayoutGrids, layoutGridPath, layoutGridSections } from "./layout-grid-overlay-model.ts";

function frame(layoutGrids, { id = "frame-1", sourceNodeId = id, sourceWidth = 375, sourceHeight = 812 } = {}) {
  return {
    id,
    sourceWidth,
    sourceHeight,
    nodes: [{ sourceNodeId, sourcePayload: { layoutGrids } }],
  };
}

test("reads visible grid types from the captured root frame and ignores hidden or malformed entries", () => {
  const screen = frame([
    { pattern: "COLUMNS", visible: true },
    { pattern: "ROWS", visible: false },
    { pattern: "DIAGONAL", visible: true },
    null,
  ]);
  screen.nodes.push({ sourceNodeId: "child-1", sourcePayload: { layoutGrids: [{ pattern: "GRID", visible: true }] } });
  const grids = getVisibleLayoutGrids(screen);

  assert.deepEqual(grids, [{ pattern: "COLUMNS", visible: true }]);
  assert.deepEqual(getVisibleLayoutGrids(frame([{ pattern: "GRID", visible: true }], { sourceNodeId: "wrong-root" })), []);
});

test("enables the grid control only when a screen has a visible captured grid", () => {
  assert.equal(hasVisibleLayoutGrids([
    frame([{ pattern: "ROWS", visible: false }]),
    frame([{ pattern: "GRID", visible: true }], { id: "screen-2", sourceNodeId: "screen-2" }),
  ]), true);
  assert.equal(hasVisibleLayoutGrids([frame([{ pattern: "COLUMNS", visible: false }])]), false);
});

test("lays out automatic columns using the captured frame width, offset, and gutter", () => {
  assert.deepEqual(layoutGridSections({
    pattern: "COLUMNS",
    alignment: "MIN",
    count: "AUTO",
    sectionSize: 72,
    gutterSize: 16,
    offset: 12,
  }, 375), {
    count: 4,
    sectionSize: 72,
    gutter: 16,
    start: 12,
  });
});

test("uses frame height when laying out automatic rows", () => {
  assert.deepEqual(layoutGridSections({
    pattern: "ROWS",
    alignment: "MIN",
    count: "AUTO",
    sectionSize: 48,
    gutterSize: 8,
    offset: 16,
  }, 812), {
    count: 14,
    sectionSize: 48,
    gutter: 8,
    start: 16,
  });
});

test("lays out stretch grids from their exact count and captured frame extent", () => {
  const result = layoutGridSections({
    pattern: "COLUMNS",
    alignment: "STRETCH",
    count: 3,
    gutterSize: 16,
    offset: 12,
  }, 375);

  assert.deepEqual(result, {
    count: 3,
    sectionSize: 319 / 3,
    gutter: 16,
    start: 12,
  });
});

test("renders square grid paths within the line budget and rejects pathological density", () => {
  const path = layoutGridPath({ pattern: "GRID", sectionSize: 20 }, 100, 80);

  assert.equal(path?.match(/M/g)?.length, 11);
  assert.equal(layoutGridPath({ pattern: "GRID", sectionSize: 0.01 }, 100, 80), null);
});
