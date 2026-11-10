import assert from "node:assert/strict";
import test from "node:test";
import { jsonByteLength } from "../src/json-byte-length.ts";

test("counts JSON UTF-8 bytes exactly for nested values and escaped text", () => {
  const values = [
    null,
    { name: "Paywall Membership", bounds: { width: 440, height: 956 } },
    ["quote: \"", "slash: \",", "line\nfeed", "accent: é", "emoji: 🧭"],
    { undefinedProperty: undefined, omitted: () => {}, list: [undefined, null, true, false, -0, 1e-7, 1e21] },
    "\u0000\u0008\u000b\ud800\udc00\ud800\udc00",
  ];
  const encoder = new TextEncoder();

  for (const value of values) {
    const json = JSON.stringify(value);
    assert.equal(jsonByteLength(value), encoder.encode(json).byteLength, `byte count for ${json}`);
  }
});
