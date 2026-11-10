import assert from "node:assert/strict";
import test from "node:test";

const filterModule = await import("./changed-frame-filter.ts").catch(() => ({}));

const frames = [
  { id: "changed" },
  { id: "added" },
  { id: "only-after" },
  { id: "unchanged" },
  { id: "removed" },
];
const statuses = {
  changed: "changed",
  added: "added",
  "only-after": "only-in-after-capture",
  unchanged: "unchanged",
  removed: "removed",
};

test("filters the canvas to changed, added, and after-only captured screens", () => {
  assert.equal(typeof filterModule.filterChangedFrames, "function");
  assert.deepEqual(
    filterModule.filterChangedFrames(frames, true, statuses, true).map((frame) => frame.id),
    ["changed", "added", "only-after"],
  );
});

test("keeps every screen when the filter is off or no comparison is available", () => {
  assert.equal(typeof filterModule.filterChangedFrames, "function");
  assert.deepEqual(filterModule.filterChangedFrames(frames, false, statuses, true), frames);
  assert.deepEqual(filterModule.filterChangedFrames(frames, true, statuses, false), frames);
});
