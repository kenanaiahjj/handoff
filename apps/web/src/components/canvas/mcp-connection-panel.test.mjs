import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./McpConnectionPanel.tsx", import.meta.url), "utf8");

test("agent setup explains every MCP scope needed for handoff workflows", () => {
  const setupStep = source.match(/<li[^>]*>[^<]*<span[^>]*>1<\/span>[\s\S]*?Create a token[\s\S]*?<\/li>/);
  assert.ok(setupStep, "the first setup step must explain the token scopes");
  assert.match(setupStep[0], /handoffs:read/);
  assert.match(setupStep[0], /comments:write[\s\S]*comment/i);
  assert.match(setupStep[0], /changelog:write[\s\S]*changelog draft/i);
  assert.match(setupStep[0], /tasks:write[\s\S]*task/i);
});
