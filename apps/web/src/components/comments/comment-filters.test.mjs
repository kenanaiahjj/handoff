import assert from "node:assert/strict";
import test from "node:test";
import { stepOpenThread, visibleThreadIds } from "./comment-filters.ts";

const comment = (id, extra = {}) => ({ id, parentCommentId: null, createdBy: "ben", body: "Looks good", resolvedAt: null, frameId: "s1", ...extra });
const comments = [
  comment("a"),
  comment("a1", { parentCommentId: "a", createdBy: "ana" }),
  comment("b", { body: "@[Ana](user:ana) can you check?" }),
  comment("c", { resolvedAt: "2026-11-20T00:00:00Z", createdBy: "ana" }),
  comment("d"),
];

test("Mine is threads you started or replied in; Mentions me is threads that @mention you", () => {
  assert.equal(visibleThreadIds(comments, "all", "ana"), null);
  assert.equal(visibleThreadIds(comments, "mine", null), null, "no one signed in: nothing to filter by");
  assert.deepEqual([...visibleThreadIds(comments, "mine", "ana")].sort(), ["a", "c"]);
  assert.deepEqual([...visibleThreadIds(comments, "mentions", "ana")], ["b"]);
});

test("N steps through open threads, wrapping, and skips resolved and filtered-out ones", () => {
  assert.equal(stepOpenThread(comments, null, 1, null).id, "a");
  assert.equal(stepOpenThread(comments, null, -1, null).id, "d");
  assert.equal(stepOpenThread(comments, "b", 1, null).id, "d", "c is resolved");
  assert.equal(stepOpenThread(comments, "d", 1, null).id, "a");
  assert.equal(stepOpenThread(comments, "a", 1, new Set(["a", "c"])).id, "a", "only one open thread is mine");
  assert.equal(stepOpenThread(comments, null, 1, new Set(["c"])), null);
});
