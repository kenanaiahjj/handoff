import assert from "node:assert/strict";
import test from "node:test";
import { overviewClipPath } from "./overview-clip.ts";

test("the overview is clipped to the version's current screens", () => {
  assert.equal(
    overviewClipPath([{ x: 10, y: 20, width: 30.123, height: 40 }, { x: 0, y: 0, width: 5, height: 5 }]),
    'path(nonzero, "M10 20h30.12v40h-30.12ZM0 0h5v5h-5Z")',
  );
});

test("without screen outlines the overview is shown unclipped, and with none left it is hidden", () => {
  assert.equal(overviewClipPath(undefined), undefined);
  assert.equal(overviewClipPath([]), "inset(50%)");
  assert.equal(overviewClipPath([{ x: 0, y: 0, width: 0, height: 10 }, { x: Number.NaN, y: 0, width: 1, height: 1 }]), "inset(50%)");
});
