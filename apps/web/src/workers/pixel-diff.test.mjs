import assert from "node:assert/strict";
import test from "node:test";
import { compareRgbaPixels } from "./pixel-diff.ts";

test("detects subtle color changes in captured screen pixels", () => {
  const before = new Uint8ClampedArray([255, 255, 255, 255]);
  const after = new Uint8ClampedArray([255, 248, 240, 255]);

  const result = compareRgbaPixels(before, after);

  assert.equal(result.changedPixels, 1);
  assert.deepEqual([...result.pixels], [255, 75, 125, 85]);
});

test("leaves identical pixels transparent", () => {
  const pixels = new Uint8ClampedArray([20, 30, 40, 255]);

  const result = compareRgbaPixels(pixels, pixels);

  assert.equal(result.changedPixels, 0);
  assert.deepEqual([...result.pixels], [0, 0, 0, 0]);
});

test("detects one-level changes while preserving the measured intensity", () => {
  const result = compareRgbaPixels(
    new Uint8ClampedArray([100, 100, 100, 255]),
    new Uint8ClampedArray([101, 100, 100, 255]),
  );

  assert.equal(result.changedPixels, 1);
  assert.equal(result.pixels[3], 71);
});

test("rejects pixel buffers with different lengths", () => {
  assert.throws(
    () => compareRgbaPixels(new Uint8ClampedArray(4), new Uint8ClampedArray(8)),
    /same number of RGBA values/,
  );
});
