import assert from "node:assert/strict";
import test from "node:test";
import { colorDistance, describePick, parseColor, screenPalette, toHex } from "./eyedropper-colors.ts";

test("reads the colour formats captures and tokens use", () => {
  assert.deepEqual(parseColor("#f60"), { r: 255, g: 102, b: 0, a: 1 });
  assert.deepEqual(parseColor("#FF660080"), { r: 255, g: 102, b: 0, a: 128 / 255 });
  assert.deepEqual(parseColor("rgba(10, 20, 30, 0.5)"), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.deepEqual(parseColor({ r: 1, g: 0.4, b: 0, a: 1 }), { r: 255, g: 102, b: 0, a: 1 });
  assert.equal(parseColor("16px"), null);
  assert.equal(parseColor(null), null);
  assert.equal(toHex({ r: 255, g: 102, b: 0, a: 1 }), "#FF6600");
});

test("measures perceived distance", () => {
  assert.equal(colorDistance(parseColor("#ff6600"), parseColor("#ff6600")), 0);
  assert.ok(colorDistance(parseColor("#ff6600"), parseColor("#ff6601")) < 1);
  assert.ok(colorDistance(parseColor("#ff6600"), parseColor("#0066ff")) > 30);
});

test("names the nearest token for a sampled pixel", () => {
  const palette = screenPalette([
    { fills: [{ color: "#FF6600" }], strokes: [], tokens: [{ name: "brand/primary", value: "#ff6600" }] },
    { fills: [{ color: "#111111" }], strokes: [], tokens: [] },
  ]);
  assert.deepEqual(describePick(parseColor("#ff6600"), palette), { hex: "#FF6600", detail: "token brand/primary" });
  assert.match(describePick(parseColor("#ff7a10"), palette).detail, /^near token brand\/primary/);
  assert.equal(describePick(parseColor("#111111"), palette).detail, "a captured colour with no token");
  assert.match(describePick(parseColor("#3399ff"), palette).detail, /not a colour the layers use/);
});
