import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowGridLayout } from "./grid-layout.ts";

const emptyGridData = {
  gridColumnCount: 0,
  gridRowCount: 0,
  gridColumnSizes: [],
  gridRowSizes: [],
};

test("does not show a grid panel for a horizontal auto-layout with zero inactive grid counts", () => {
  assert.equal(shouldShowGridLayout({ mode: "HORIZONTAL", ...emptyGridData }), false);
});

test("shows grid data when the source layout mode is GRID", () => {
  assert.equal(shouldShowGridLayout({ mode: "GRID", ...emptyGridData }), true);
});

test("shows populated grid data when the source does not report a layout mode", () => {
  assert.equal(shouldShowGridLayout({ mode: null, ...emptyGridData, gridColumnCount: 3 }), true);
});
