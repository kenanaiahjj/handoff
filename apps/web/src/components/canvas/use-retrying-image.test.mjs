import assert from "node:assert/strict";
import test from "node:test";
import { retryImageSrc } from "./use-retrying-image.ts";

test("retries fetch the image again without changing which asset it is", () => {
  assert.equal(retryImageSrc("/api/assets/abc", 0), "/api/assets/abc");
  assert.equal(retryImageSrc("/api/assets/abc", 2), "/api/assets/abc?retry=2");
  assert.equal(retryImageSrc("/api/review/s/assets/abc?download=1", 1), "/api/review/s/assets/abc?download=1&retry=1");
});
