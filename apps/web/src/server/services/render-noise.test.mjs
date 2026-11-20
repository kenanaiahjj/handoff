import assert from "node:assert/strict";
import test from "node:test";
import { countVisiblyChangedPixels, isRenderNoise } from "./render-noise.ts";

function image(width, height, paint = () => [255, 255, 255]) {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) data.set(paint(i), i * 3);
  return { width, height, channels: 3, data };
}

test("a few faint anti-aliasing pixels are render noise", () => {
  // Tripket "Partial Cancellation List": 5 pixels differing by at most 11 of 255.
  const before = image(100, 100);
  const after = image(100, 100, (i) => (i < 5 ? [244, 244, 244] : [255, 255, 255]));
  assert.equal(countVisiblyChangedPixels(before, after), 0);
  assert.ok(isRenderNoise(countVisiblyChangedPixels(before, after)));
});

test("a visible edit, even a small icon recolor, is a real change", () => {
  const before = image(100, 100);
  const after = image(100, 100, (i) => (i < 16 * 16 ? [52, 168, 83] : [255, 255, 255]));
  assert.equal(countVisiblyChangedPixels(before, after), 256);
  assert.equal(isRenderNoise(countVisiblyChangedPixels(before, after)), false);
});

test("images of different sizes are never treated as noise", () => {
  assert.equal(countVisiblyChangedPixels(image(10, 10), image(10, 12)), null);
  assert.equal(isRenderNoise(null), false);
});
