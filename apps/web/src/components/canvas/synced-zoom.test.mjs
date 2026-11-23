import assert from "node:assert/strict";
import test from "node:test";
import { fitView, zoomAt } from "./SyncedZoom.tsx";

test("zooming keeps the point under the cursor in place", () => {
  const view = zoomAt(fitView, 2, 100, 50);
  assert.deepEqual(view, { scale: 2, x: -100, y: -50 });
  // The pane point (100, 50) maps back to the same content point (100, 50).
  assert.equal((100 - view.x) / view.scale, 100);
  assert.equal((50 - view.y) / view.scale, 50);
});

test("zoom stays between 25% and 800%, and passing through 100% snaps back to fit", () => {
  assert.equal(zoomAt(fitView, 100, 0, 0).scale, 8);
  assert.deepEqual(zoomAt({ scale: 2, x: -40, y: -10 }, 0.25, 30, 30), fitView);
  assert.deepEqual(zoomAt({ scale: 0.5, x: 100, y: 50 }, 4, 30, 30), fitView);
});

test("zooming out from fit goes below 100% around the cursor", () => {
  const view = zoomAt(fitView, 0.5, 200, 100);
  assert.deepEqual(view, { scale: 0.5, x: 100, y: 50 });
  assert.equal(zoomAt(view, 0.01, 0, 0).scale, 0.25);
});
