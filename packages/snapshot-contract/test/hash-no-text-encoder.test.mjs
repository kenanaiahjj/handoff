import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

test("hashSnapshotPayload works when the host does not provide TextEncoder", async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "TextEncoder");
  Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: undefined });

  try {
    let hashModule;
    try {
      hashModule = await import("../src/hash.ts?without-text-encoder");
    } catch (error) {
      assert.fail(`hash module should load without TextEncoder: ${error}`);
    }

    const payload = { text: "Tripket ✨\uD800" };
    const canonicalJson = JSON.stringify(payload);
    const expected = createHash("sha256").update(canonicalJson, "utf8").digest("hex");
    assert.equal(await hashModule.hashSnapshotPayload(payload), expected);
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, "TextEncoder", originalDescriptor);
    else Reflect.deleteProperty(globalThis, "TextEncoder");
  }
});
