import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("./McpConnectionPanel.tsx", import.meta.url), "utf8");
const guide = readFileSync(new URL("../integrations/McpConnectGuide.tsx", import.meta.url), "utf8");

test("the in-canvas panel uses the shared sign-in guide, not a token form", () => {
  assert.match(panel, /<McpConnectGuide compact \/>/);
  assert.doesNotMatch(panel, /Create a token/);
});

test("the guide sets up each client with browser sign-in and no token", () => {
  assert.match(guide, /claude mcp add --transport http/);
  assert.match(guide, /codex mcp login asbir-handoff/);
  assert.match(guide, /No token to copy/);
});
