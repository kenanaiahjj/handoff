import assert from "node:assert/strict";
import test from "node:test";
import { canvasImageVariantSrc, pickCanvasImageSize, resolutionNeed, sameScreenIds, screensInView } from "./canvas-screen-culling.ts";

// A 4000×1000 overview with screens laid out in a row, 1000px apart.
const screens = [0, 1000, 2000, 3000].map((x, index) => ({ id: "s" + index, sourceX: 500 + x, sourceY: 200, sourceWidth: 800, sourceHeight: 600 }));
const view = { frameSourceX: 500, frameSourceY: 200, frameWidth: 4000, frameHeight: 1000, viewportWidth: 1000, viewportHeight: 800, margin: 0 };

test("keeps every screen when the whole canvas fits", () => {
  assert.deepEqual(screensInView(screens, { ...view, offsetX: 0, offsetY: 0, scale: 0.2 }).map((s) => s.id), ["s0", "s1", "s2", "s3"]);
});

test("keeps only the screens under the viewport when zoomed in", () => {
  // At 100% centred, the viewport shows canvas x 1500–2500: screen s1 (1000–1800) and s2 (2000–2800).
  assert.deepEqual(screensInView(screens, { ...view, offsetX: 0, offsetY: 0, scale: 1 }).map((s) => s.id), ["s1", "s2"]);
  // Panning right by 1500 screen pixels moves the view to canvas x 0–1000: only s0.
  assert.deepEqual(screensInView(screens, { ...view, offsetX: 1500, offsetY: 0, scale: 1 }).map((s) => s.id), ["s0"]);
});

test("the margin pulls in neighbours just outside the viewport", () => {
  assert.deepEqual(screensInView(screens, { ...view, offsetX: 1500, offsetY: 0, scale: 1, margin: 0.5 }).map((s) => s.id), ["s0", "s1"]);
});

test("falls back to every screen before the viewport is measured", () => {
  assert.equal(screensInView(screens, { ...view, viewportWidth: 0, offsetX: 0, offsetY: 0, scale: 1 }).length, 4);
});

test("compares screen lists by id and order", () => {
  assert.equal(sameScreenIds(screens, [...screens]), true);
  assert.equal(sameScreenIds(screens, screens.slice(1)), false);
});

test("resolution need only changes when zoom roughly doubles", () => {
  assert.equal(resolutionNeed(0.3, 1), 0.5);
  assert.equal(resolutionNeed(0.45, 1), 0.5);
  assert.equal(resolutionNeed(0.3, 2), 1);
  assert.equal(resolutionNeed(1.5, 2), 4);
});

test("picks the smallest image with enough pixels, accounting for 2x captures", () => {
  const oneX = { pixelWidth: 800, sourceWidth: 800 };
  const twoX = { pixelWidth: 1600, sourceWidth: 800 };
  assert.equal(pickCanvasImageSize(0.25, oneX), 0.25);
  assert.equal(pickCanvasImageSize(0.5, oneX), 0.5);
  assert.equal(pickCanvasImageSize(1, oneX), 1);
  assert.equal(pickCanvasImageSize(1, twoX), 0.5);
  assert.equal(pickCanvasImageSize(0.5, twoX), 0.25);
  assert.equal(pickCanvasImageSize(4, twoX), 1);
});

test("smaller sizes ask for a copy; vectors and full size use the original", () => {
  assert.equal(canvasImageVariantSrc({ imageSrc: "/api/assets/abc", fileName: "a.png" }, 1), "/api/assets/abc");
  assert.equal(canvasImageVariantSrc({ imageSrc: "/api/assets/abc", fileName: "a.png" }, 0.5), "/api/assets/abc?size=half");
  assert.equal(canvasImageVariantSrc({ imageSrc: "/api/assets/abc?x=1", fileName: "a.png" }, 0.25), "/api/assets/abc?x=1&size=quarter");
  assert.equal(canvasImageVariantSrc({ imageSrc: "/api/assets/abc", fileName: "a.svg" }, 0.25), "/api/assets/abc");
});
