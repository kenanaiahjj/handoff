import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { setObjectStoreForTests } from "../storage/supabase-object-store.ts";
import { assetVariantKey, parseAssetVariantSize } from "./asset-variants.ts";
import { createAssetResponse } from "./asset-response.ts";

const objectKey = "a".repeat(48);

function memoryStore() {
  const objects = new Map();
  return {
    objects,
    async put(key, bytes, contentType) {
      if (objects.has(key)) throw new Error("exists");
      objects.set(key, { bytes, contentType });
    },
    async get(key) { return objects.get(key) ?? null; },
    async delete(key) { objects.delete(key); },
    async createSignedUploadUrl() { throw new Error("unused"); },
    async createSignedDownloadUrl(key, options = {}) { return `https://storage.test/${key}?expires=${options.expiresIn}`; },
  };
}

async function withStore(store, run) {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  setObjectStoreForTests(store);
  try { await run(); } finally { setObjectStoreForTests(undefined); process.env.NODE_ENV = previousEnv; }
}

const asset = (contentType = "image/png") => ({ objectKey, fileName: "screen.png", contentType, sizeBytes: 1, sha256: "b".repeat(64) });

test("variant keys look like stored object keys and differ per size", () => {
  assert.match(assetVariantKey(objectKey, "half"), /^[a-f0-9]{48}$/);
  assert.notEqual(assetVariantKey(objectKey, "half"), assetVariantKey(objectKey, "quarter"));
  assert.equal(parseAssetVariantSize("half"), "half");
  assert.equal(parseAssetVariantSize("full"), null);
});

test("makes a half-width WebP once and redirects to it", async () => {
  const store = memoryStore();
  const png = await sharp({ create: { width: 400, height: 200, channels: 4, background: "#ff0000" } }).png().toBuffer();
  store.objects.set(objectKey, { bytes: new Uint8Array(png), contentType: "image/png" });
  await withStore(store, async () => {
    const response = await createAssetResponse(new Request("http://localhost/api/assets/x?size=half"), asset());
    assert.equal(response.status, 307);
    const variantKey = assetVariantKey(objectKey, "half");
    assert.equal(response.headers.get("Location"), `https://storage.test/${variantKey}?expires=3600`);
    assert.match(response.headers.get("Cache-Control"), /private, max-age=3300/);
    assert.equal(response.headers.get("ETag"), null);
    const stored = store.objects.get(variantKey);
    assert.equal(stored.contentType, "image/webp");
    const metadata = await sharp(Buffer.from(stored.bytes)).metadata();
    assert.equal(metadata.width, 200);
    assert.equal(metadata.format, "webp");
    // The original is untouched.
    assert.equal(store.objects.get(objectKey).contentType, "image/png");
  });
});

test("serves the original when a copy can't be made", async () => {
  const store = memoryStore(); // the original is missing, so making a copy fails
  await withStore(store, async () => {
    const response = await createAssetResponse(new Request("http://localhost/api/assets/x?size=quarter"), asset());
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("Location"), `https://storage.test/${objectKey}?expires=3600`);
  });
});

test("downloads stay short-lived and uncached, and ignore the size", async () => {
  await withStore(memoryStore(), async () => {
    const response = await createAssetResponse(new Request("http://localhost/api/assets/x?download=1&size=half"), asset());
    assert.equal(response.headers.get("Location"), `https://storage.test/${objectKey}?expires=300`);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });
});
