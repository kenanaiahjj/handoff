import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifestTemplate = JSON.parse(readFileSync(new URL("../manifest.template.json", import.meta.url), "utf8"));

test("enables the Figma private plugin API needed to read file identity", () => {
  assert.equal(manifestTemplate.enablePrivatePluginApi, true);
});
