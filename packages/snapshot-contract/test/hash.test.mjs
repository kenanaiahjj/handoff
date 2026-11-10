import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { hashSnapshotPayload } from "../src/hash.ts";

function legacyCanonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(legacyCanonicalize).join(",")}]`;
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${legacyCanonicalize(entry)}`).join(",")}}`;
}

test("hashSnapshotPayload preserves canonical hashes and ignores object insertion order", async () => {
  const payload = { z: ["hello", 4, true], a: { text: "Tripket ✨", omitted: undefined }, contentHash: "ignored" };
  const expected = createHash("sha256").update(legacyCanonicalize({ z: payload.z, a: payload.a }), "utf8").digest("hex");

  assert.equal(await hashSnapshotPayload(payload), expected);
  assert.equal(await hashSnapshotPayload({ a: payload.a, z: payload.z }), expected);
});

test("hashSnapshotPayload encodes large text in bounded chunks", async () => {
  const originalEncodeURIComponent = globalThis.encodeURIComponent;
  const originalEncode = TextEncoder.prototype.encode;
  let largestChunk = 0;
  globalThis.encodeURIComponent = (value) => {
    largestChunk = Math.max(largestChunk, value.length);
    return originalEncodeURIComponent(value);
  };
  TextEncoder.prototype.encode = function(value) {
    largestChunk = Math.max(largestChunk, value.length);
    return originalEncode.call(this, value);
  };

  try {
    const digest = await hashSnapshotPayload({ text: "x".repeat(1024 * 1024) });
    assert.match(digest, /^[a-f0-9]{64}$/);
  } finally {
    globalThis.encodeURIComponent = originalEncodeURIComponent;
    TextEncoder.prototype.encode = originalEncode;
  }

  assert.ok(largestChunk <= 16 * 1024, `expected bounded encoding chunks, got ${largestChunk} characters`);
});
