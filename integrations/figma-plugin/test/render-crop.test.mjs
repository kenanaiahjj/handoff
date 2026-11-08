import assert from "node:assert/strict";
import test from "node:test";
import { frameRenderCrop } from "../src/render-crop.ts";

test("maps frame bounds to pixels inside a Figma render that includes overflow", () => {
  assert.deepEqual(
    frameRenderCrop(
      { x: 10, y: 20, width: 100, height: 100 },
      { x: 5, y: 10, width: 150, height: 125 },
      300,
      250,
    ),
    { x: 10, y: 20, width: 200, height: 200 },
  );
});

test("skips a crop when the render already matches the frame", () => {
  assert.equal(
    frameRenderCrop(
      { x: 5, y: 10, width: 100, height: 100 },
      { x: 5, y: 10, width: 100, height: 100 },
      200,
      200,
    ),
    null,
  );
});
