import assert from "node:assert/strict";
import test from "node:test";
import { compareRgbaPixels, getPixelDiffPlan } from "./pixel-diff.ts";

test("keeps a standard tall mobile screen at exact 2x comparison resolution", () => {
  assert.deepEqual(getPixelDiffPlan(393, 2073, 393, 2073), {
    status: "ready",
    width: 786,
    height: 4146,
    pixelCount: 3_258_756,
  });
});

test("keeps a common desktop screen at exact 2x comparison resolution", () => {
  assert.deepEqual(getPixelDiffPlan(1440, 900, 1440, 900), {
    status: "ready",
    width: 2880,
    height: 1800,
    pixelCount: 5_184_000,
  });
});

test("refuses oversized pixel diffs before allocating image buffers", () => {
  assert.deepEqual(getPixelDiffPlan(2560, 1440, 2560, 1440), {
    status: "too-large",
    width: 5120,
    height: 2880,
    pixelCount: 14_745_600,
  });
});

test("rejects invalid source dimensions", () => {
  assert.deepEqual(getPixelDiffPlan(0, 100, 100, 100), {
    status: "invalid",
  });
});

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
