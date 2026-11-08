import assert from "node:assert/strict";
import test from "node:test";
import { versionsVisibleToReview } from "./published-review.ts";

test("a published review includes the published version and earlier snapshots only", () => {
  const versions = [{ id: "v3" }, { id: "v2" }, { id: "v1" }];

  assert.deepEqual(versionsVisibleToReview(versions, "v2"), [{ id: "v2" }, { id: "v1" }]);
});

test("a missing published version exposes no snapshots", () => {
  assert.deepEqual(versionsVisibleToReview([{ id: "v2" }, { id: "v1" }], "deleted-version"), []);
});
