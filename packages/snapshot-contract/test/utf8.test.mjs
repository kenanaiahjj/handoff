import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { encodeUtf8 } from "../src/utf8.ts";

test("encodes Unicode as UTF-8", () => {
  const value = 'Tripket 🚢 café 日本';
  assert.deepEqual(encodeUtf8(value), new TextEncoder().encode(value));
});

test("encodes surrogate pairs across chunk boundaries without TextEncoder", () => {
  const value = 'a'.repeat(16_383) + '🚢 café';
  const expected = new TextEncoder().encode(value);
  const saved = globalThis.TextEncoder;
  try {
    globalThis.TextEncoder = undefined;
    assert.deepEqual(encodeUtf8(value), expected);
  } finally {
    globalThis.TextEncoder = saved;
  }
});

test("encodes a large snapshot within a bounded JavaScript heap", () => {
  const moduleUrl = new URL("../src/utf8.ts", import.meta.url).href;
  const script = `import { encodeUtf8 } from ${JSON.stringify(moduleUrl)};
    const bytes = encodeUtf8('a'.repeat(32 * 1024 * 1024));
    if (bytes.length !== 32 * 1024 * 1024 || bytes[bytes.length - 1] !== 97) process.exit(1);`;
  const child = spawnSync(process.execPath, ["--max-old-space-size=96", "--experimental-transform-types", "--input-type=module", "-e", script], { encoding: "utf8", timeout: 30000 });
  assert.equal(child.status, 0, child.stderr.slice(-1000));
});
