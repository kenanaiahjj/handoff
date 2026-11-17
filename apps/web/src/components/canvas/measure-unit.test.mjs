import assert from "node:assert/strict";
import test from "node:test";
import { formatLength, formatLengthNumber } from "./measure-unit.ts";

test("lengths show in the chosen unit", () => {
  assert.equal(formatLength(16, "px"), "16 px");
  assert.equal(formatLength(16.333, "pt"), "16.33 pt");
  assert.equal(formatLength(24, "dp"), "24 dp");
  assert.equal(formatLength(24, "rem"), "1.5 rem");
  assert.equal(formatLength(13, "rem"), "0.813 rem");
  assert.equal(formatLengthNumber(24, "rem"), "1.5");
  assert.equal(formatLength(Number.NaN, "px"), "—");
});
