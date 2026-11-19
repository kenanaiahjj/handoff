import assert from "node:assert/strict";
import test from "node:test";
import { retainPendingUploadForToken } from "../src/pending-upload.ts";

test("keeps a prepared upload only while its capture token still matches", () => {
  const pending = { token: "current-token", snapshot: { frames: 204 } };

  assert.equal(retainPendingUploadForToken(pending, " current-token "), pending);
  assert.equal(retainPendingUploadForToken(pending, "replacement-token"), null);
  assert.equal(retainPendingUploadForToken(null, "current-token"), null);
});
