import assert from "node:assert/strict";
import test from "node:test";

const concurrencyModule = await import("./map-with-concurrency.ts").catch(() => null);

test("mapWithConcurrency caps active work and keeps results in input order", async () => {
  assert.ok(concurrencyModule, "the bounded concurrency helper must exist");

  let active = 0;
  let peakActive = 0;
  const items = Array.from({ length: 17 }, (_, index) => index);
  const results = await concurrencyModule.mapWithConcurrency(items, 4, async (item) => {
    active += 1;
    peakActive = Math.max(peakActive, active);
    await new Promise((resolve) => setTimeout(resolve, item % 3));
    active -= 1;
    return item * 2;
  });

  assert.equal(peakActive, 4);
  assert.deepEqual(results, items.map((item) => item * 2));
});
