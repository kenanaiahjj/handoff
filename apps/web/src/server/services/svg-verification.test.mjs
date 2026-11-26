import assert from "node:assert/strict";
import test from "node:test";
import { verifyRenderAssetBytes } from "./import-snapshot.ts";

const svg = (markup) => new TextEncoder().encode(markup);

test("a hairline divider SVG is accepted with a 1px size instead of failing the capture", () => {
  const size = verifyRenderAssetBytes(svg('<svg width="343" height="0.5" viewBox="0 0 343 0.5" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="0.25" x2="343" y2="0.25" stroke="#E5E5EA"/></svg>'), "image/svg+xml", "divider.svg");
  assert.deepEqual(size, { width: 343, height: 1 });
});

test("layer names in id values are not mistaken for event handlers", () => {
  const markup = '<svg width="24" height="24" xmlns="http://www.w3.org/2000/svg"><g id="Toggle onboarding=true"><rect id="State onclick=off" width="24" height="24"/></g></svg>';
  assert.doesNotThrow(() => verifyRenderAssetBytes(svg(markup), "image/svg+xml", "toggle.svg"));
});

test("real event handlers and scripts are still rejected", () => {
  assert.throws(() => verifyRenderAssetBytes(svg('<svg width="24" height="24" onload="alert(1)"></svg>'), "image/svg+xml", "bad.svg"), /event handler/);
  assert.throws(() => verifyRenderAssetBytes(svg('<svg width="24" height="24"><script>alert(1)</script></svg>'), "image/svg+xml", "bad.svg"), /active content/);
});
