import assert from "node:assert/strict";
import test from "node:test";
import { layoutScreensInRow, unionRect } from "./screen-image.ts";
import { snapshotArea } from "./useCanvasMarkup.tsx";

const screen = (id, x, y, width = 100, height = 200) => ({ id, name: id, sourceX: x, sourceY: y, sourceWidth: width, sourceHeight: height });

test("screens copied together line up in a row, without the empty canvas between them", () => {
  const placed = layoutScreensInRow([screen("a", 5000, 300), screen("b", 0, 0, 50, 400)]);
  assert.deepEqual(placed.map(({ sourceX, sourceY }) => [sourceX, sourceY]), [[0, 0], [140, 0]]);
  assert.deepEqual(unionRect(placed.map((item) => ({ x: item.sourceX, y: item.sourceY, width: item.sourceWidth, height: item.sourceHeight }))), { x: 0, y: 0, width: 190, height: 400 });
});

test("a markup snapshot covers every screen a stroke touches", () => {
  const screens = [screen("a", 0, 0), screen("b", 200, 0), screen("c", 400, 0)];
  const strokes = [{ id: "1", color: "#f00", width: 4, highlighter: false, points: [[50, 50], [250, 60]] }];
  assert.deepEqual(snapshotArea(strokes, screens), { x: 0, y: 0, width: 300, height: 200 });
  assert.equal(snapshotArea([], screens), null);
});
