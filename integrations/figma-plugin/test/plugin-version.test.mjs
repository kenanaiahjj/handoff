import assert from "node:assert/strict";
import test from "node:test";
import { isPluginOutdated, pluginUpdatePageUrl, pluginVersionUrl } from "../src/plugin-version.ts";

test("a stamped build is outdated only when the server hands out a different build", () => {
  assert.equal(isPluginOutdated("aaaaaaaaaaaa", { build: "bbbbbbbbbbbb" }), true);
  assert.equal(isPluginOutdated("aaaaaaaaaaaa", { build: "aaaaaaaaaaaa" }), false);
});

test("dev builds and unreadable answers never prompt an update", () => {
  assert.equal(isPluginOutdated("asbir-plugin-build-placeholder", { build: "bbbbbbbbbbbb" }), false);
  assert.equal(isPluginOutdated("aaaaaaaaaaaa", { error: "missing" }), false);
  assert.equal(isPluginOutdated("aaaaaaaaaaaa", { build: "<script>" }), false);
  assert.equal(isPluginOutdated("aaaaaaaaaaaa", null), false);
});

test("version and update addresses stay on the plugin's server", () => {
  assert.equal(pluginVersionUrl("https://handoff.example.com"), "https://handoff.example.com/api/capture-sessions/plugin-version");
  assert.equal(pluginUpdatePageUrl("https://handoff.example.com"), "https://handoff.example.com/integrations?open=figma");
});
