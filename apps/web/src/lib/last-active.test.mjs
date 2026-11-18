import assert from "node:assert/strict";
import test from "node:test";
import { formatLastActive } from "./last-active.ts";

const now = Date.parse("2026-11-18T12:00:00.000Z");

test("last active reads as a short relative date", () => {
  assert.equal(formatLastActive(null, now), "Never signed in");
  assert.equal(formatLastActive("2026-11-18T08:00:00.000Z", now), "Today");
  assert.equal(formatLastActive("2026-11-17T08:00:00.000Z", now), "Yesterday");
  assert.equal(formatLastActive("2026-11-08T12:00:00.000Z", now), "10 days ago");
  assert.equal(formatLastActive("not a date", now), "Unknown");
  assert.match(formatLastActive("2026-08-01T12:00:00.000Z", now), /Aug/);
});
