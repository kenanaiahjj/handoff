import assert from "node:assert/strict";
import test from "node:test";
test("local Storage upload credentials are bound to one object key and expire", async () => {
  const localStorage = await import("./local-object-store.ts");
  assert.equal(typeof localStorage.verifyLocalObjectToken, "function");
  const previousEnvironment = {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET,
  };
  process.env.BETTER_AUTH_SECRET = "local-test-secret-that-is-long-enough";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.SUPABASE_STORAGE_BUCKET = "handoff-assets";

  try {
    const objectKey = "a".repeat(48);
    const otherObjectKey = "b".repeat(48);
    const store = new localStorage.LocalObjectStore("/tmp/asbir-test-objects");
    const signed = await store.createSignedUploadUrl(objectKey);
    const uploadUrl = new URL(signed.signedUrl);

    assert.equal(uploadUrl.origin, "http://localhost:3000");
    assert.equal(uploadUrl.pathname, `/storage/v1/object/upload/sign/handoff-assets/${objectKey}`);
    assert.equal(uploadUrl.searchParams.get("token"), signed.token);
    assert.equal(localStorage.verifyLocalObjectToken("upload", objectKey, signed.token), true);
    assert.equal(localStorage.verifyLocalObjectToken("upload", otherObjectKey, signed.token), false);
    assert.equal(localStorage.verifyLocalObjectToken("download", objectKey, signed.token), false);

    const [expiresAt] = signed.token.split(".");
    const expiredToken = `${Number(expiresAt) - 1}.invalid`;
    assert.equal(localStorage.verifyLocalObjectToken("upload", objectKey, expiredToken), false);
  } finally {
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
