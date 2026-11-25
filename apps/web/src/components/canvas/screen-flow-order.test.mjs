import assert from "node:assert/strict";
import test from "node:test";
import { screensInFlowOrder } from "./screen-flow-order.ts";

const s = (id, x, y, h = 800) => ({ id, sourceX: x, sourceY: y, sourceHeight: h });

test("screens read row by row, left to right", () => {
  const order = screensInFlowOrder([s("c", 900, 0), s("d", 0, 1000), s("a", 0, 40, 600), s("b", 450, 0)]);
  assert.deepEqual(order.map((screen) => screen.id), ["a", "b", "c", "d"]);
});
