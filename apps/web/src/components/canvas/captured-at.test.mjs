import assert from "node:assert/strict";
import test from "node:test";

const capturedAt = await import("./captured-at.ts").catch(() => null);

test("formats captured timestamps in a deterministic UTC representation", () => {
  assert.equal(typeof capturedAt?.formatCapturedAt, "function", "captured timestamp formatter must be available");
  assert.equal(capturedAt.formatCapturedAt("2026-11-09T13:22:00.000Z"), "Nov 9, 2026 · 1:22 PM UTC");
});

test("formats midnight and invalid timestamps safely", () => {
  assert.equal(typeof capturedAt?.formatCapturedAt, "function", "captured timestamp formatter must be available");
  assert.equal(capturedAt.formatCapturedAt("2026-11-10T00:05:00.000Z"), "Nov 10, 2026 · 12:05 AM UTC");
  assert.equal(capturedAt.formatCapturedAt("not-a-date"), "not-a-date");
});
