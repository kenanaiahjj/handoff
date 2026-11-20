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

test("zoom stays between fit and 800%, and zooming back out returns to fit", () => {
  assert.equal(zoomAt(fitView, 100, 0, 0).scale, 8);
  assert.deepEqual(zoomAt({ scale: 2, x: -40, y: -10 }, 0.25, 30, 30), fitView);
});
