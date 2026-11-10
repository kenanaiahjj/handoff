import test from "node:test";
import assert from "node:assert/strict";

const visibilityModule = await import("./canvas-frame-label-visibility.ts").catch(() => null);
const shouldShowCanvasFrameLabel = visibilityModule?.shouldShowCanvasFrameLabel ?? (() => true);
const getCanvasFrameLabelMaxWidth = visibilityModule?.getCanvasFrameLabelMaxWidth ?? (() => 0);

test("hides unselected canvas labels below the readable zoom threshold", () => {
  assert.equal(shouldShowCanvasFrameLabel(0.08, false), false);
});

test("keeps the selected screen label visible when zoomed out", () => {
  assert.equal(shouldShowCanvasFrameLabel(0.08, true), true);
});

test("shows all screen labels at the readable zoom threshold", () => {
  assert.equal(shouldShowCanvasFrameLabel(0.2, false), true);
});

test("keeps dense canvas overviews clear until a screen is selected", () => {
  assert.equal(shouldShowCanvasFrameLabel(0.24, false, 210), false);
  assert.equal(shouldShowCanvasFrameLabel(0.24, true, 210), true);
});

test("keeps the canvas label width readable in viewport pixels when zoomed out", () => {
  assert.equal(getCanvasFrameLabelMaxWidth(1000, 0.08), 6000);
});

test("caps the label to 80 percent of a narrow viewport", () => {
  assert.equal(getCanvasFrameLabelMaxWidth(320, 0.08), 3200);
});
