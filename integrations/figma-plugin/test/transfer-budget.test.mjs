import assert from "node:assert/strict";
import test from "node:test";
import { availableOverviewBudget } from "../src/transfer-budget.ts";
import { MAX_CAPTURE_ASSET_BYTES } from "../../../packages/snapshot-contract/src/limits.ts";

test("reserves overview space after counting frame, vector, and layer assets", () => {
  const megabyte = 1024 * 1024;
  const budget = availableOverviewBudget([
    { bytes: new Uint8Array(70 * megabyte) },
    { bytes: new Uint8Array(10 * megabyte) },
    { bytes: new Uint8Array(15 * megabyte) },
  ], 100 * megabyte);

  assert.equal(budget, 5 * megabyte);
});

test("returns no overview budget when existing assets already exceed the upload limit", () => {
  const budget = availableOverviewBudget([
    { bytes: new Uint8Array(60) },
    { bytes: new Uint8Array(50) },
  ], 100);

  assert.equal(budget, -10);
});

test("shares the expanded full-page capture asset budget with the overview", () => {
  const megabyte = 1024 * 1024;
  assert.equal(MAX_CAPTURE_ASSET_BYTES, 256 * megabyte);
  assert.equal(
    availableOverviewBudget([{ bytes: new Uint8Array(200 * megabyte) }], MAX_CAPTURE_ASSET_BYTES),
    56 * megabyte,
  );
});
