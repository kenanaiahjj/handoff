import assert from "node:assert/strict";
import test from "node:test";
import { assetEtag, immutableAssetCacheControl, notModifiedResponse } from "./asset-caching.ts";

const sha = "a".repeat(64);
const request = (ifNoneMatch) => new Request("http://localhost/api/assets/x", { headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : {} });

test("answers 304 only when the browser already has this exact image", () => {
  assert.equal(notModifiedResponse(request(null), sha), null);
  assert.equal(notModifiedResponse(request('"' + "b".repeat(64) + '"'), sha), null);

  const unchanged = notModifiedResponse(request(assetEtag(sha)), sha);
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.headers.get("ETag"), assetEtag(sha));
  assert.equal(unchanged.headers.get("Cache-Control"), immutableAssetCacheControl);

  // Lists and weak validators from intermediaries still match.
  assert.equal(notModifiedResponse(request(`"other", W/${assetEtag(sha)}`), sha).status, 304);
});

test("cache headers keep images out of shared caches", () => {
  assert.match(immutableAssetCacheControl, /^private,/);
  assert.match(immutableAssetCacheControl, /immutable/);
});
