import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import manifest from "./manifest.ts";

const expectedIcons = [
  { src: "/icons/asbir-handoff-v3-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/asbir-handoff-v3-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/asbir-handoff-v3-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

test("PWA install metadata uses versioned Asbir Handoff icons with matching PNG dimensions", async () => {
  assert.deepEqual(manifest().icons, expectedIcons);

  for (const size of [192, 512]) {
    const image = await readFile(new URL(`../public/icons/asbir-handoff-v3-${size}.png`, import.meta.url));
    assert.equal(image.toString("hex", 0, 8), "89504e470d0a1a0a");
    assert.equal(image.readUInt32BE(16), size);
    assert.equal(image.readUInt32BE(20), size);
  }
});
