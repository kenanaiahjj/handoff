import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./capture-sessions.ts", import.meta.url), "utf8");
const setupForm = readFileSync(
  new URL("../../../app/workspace/[workspaceId]/projects/[projectId]/handoff-setup-form.tsx", import.meta.url),
  "utf8",
);
const expiration = source.match(
  /const expiresAt = new Date\(createdAt\.getTime\(\) \+ ([^)]+)\)\.toISOString\(\);/,
);
const lifetimeFactors = expiration?.[1].match(/\d+/g)?.map(Number) ?? [];
const lifetimeMs = lifetimeFactors.reduce((product, factor) => product * factor, 1);

test("capture sessions allow one hour for large Figma captures", () => {
  assert.ok(expiration, "capture session expiry must be derived from its creation time");
  assert.equal(lifetimeMs, 60 * 60 * 1000);
});

test("Figma setup copy tells designers the token expires after one hour", () => {
  assert.match(setupForm, /expires in one hour and works once/i);
  assert.doesNotMatch(setupForm, /expires in 10 minutes/i);
});
