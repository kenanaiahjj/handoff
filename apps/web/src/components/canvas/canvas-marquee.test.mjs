import assert from "node:assert/strict";
import test from "node:test";
import { marqueeRect, mergeMarqueeSelection, screensInMarquee } from "./canvas-marquee.ts";

const screens = [
  { id: "tour-1", sourceX: 100, sourceY: 100, sourceWidth: 375, sourceHeight: 812 },
  { id: "tour-2", sourceX: 575, sourceY: 100, sourceWidth: 375, sourceHeight: 812 },
  { id: "home", sourceX: 100, sourceY: 1100, sourceWidth: 375, sourceHeight: 812 },
];
const origin = { x: 100, y: 100 };

test("the box is the same whichever way it is dragged", () => {
  assert.deepEqual(marqueeRect({ x: 50, y: 80 }, { x: 10, y: 20 }), { x: 10, y: 20, width: 40, height: 60 });
  assert.deepEqual(marqueeRect({ x: 10, y: 20 }, { x: 50, y: 80 }), { x: 10, y: 20, width: 40, height: 60 });
});

test("every screen the box touches is selected, even partly covered", () => {
  // From inside the first screen to just past the second's left edge.
  assert.deepEqual(screensInMarquee({ x: 300, y: 300, width: 200, height: 50 }, screens, origin), ["tour-1", "tour-2"]);
});

test("screens the box misses are left out", () => {
  // The gap between the two rows.
  assert.deepEqual(screensInMarquee({ x: 0, y: 830, width: 900, height: 100 }, screens, origin), []);
  assert.deepEqual(screensInMarquee({ x: 0, y: 900, width: 50, height: 300 }, screens, origin), ["home"]);
});

test("a box that only meets an edge does not select the screen", () => {
  assert.deepEqual(screensInMarquee({ x: 375, y: 0, width: 100, height: 100 }, screens, origin), []);
});

test("a plain drag replaces the selection; Shift adds to it", () => {
  const previous = new Set(["home"]);
  assert.deepEqual([...mergeMarqueeSelection(previous, ["tour-1"], false)], ["tour-1"]);
  assert.deepEqual([...mergeMarqueeSelection(previous, ["tour-1", "home"], true)], ["home", "tour-1"]);
});
