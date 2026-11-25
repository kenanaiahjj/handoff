import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeVersionLabel,
  nextVersionLabel,
  releaseNotePreview,
  startsFromLatest,
  versionLabelBase,
  versionLabelStart,
} from "./version-label.ts";

test("versionLabelBase keeps the version number and drops the sub-version", () => {
  assert.equal(versionLabelBase("2.0.5"), "2.0.5");
  assert.equal(versionLabelBase("2.0.5 · Schedules - edits"), "2.0.5");
  assert.equal(versionLabelBase("  2.0.5·Schedules "), "2.0.5");
  assert.equal(versionLabelBase("1.0 · 2 screens removed"), "1.0");
  assert.equal(versionLabelBase(""), "");
  assert.equal(versionLabelBase(null), "");
  assert.equal(versionLabelBase(undefined), "");
});

test("versionLabelStart offers the latest base with a separator", () => {
  assert.equal(versionLabelStart("2.0.5 · Schedules - edits"), "2.0.5 · ");
  assert.equal(versionLabelStart("Sprint 4"), "Sprint 4 · ");
  assert.equal(versionLabelStart(null), "");
  assert.equal(versionLabelStart("   "), "");
});

test("nextVersionLabel bumps the last number of the latest base", () => {
  assert.equal(nextVersionLabel("2.0.5"), "2.0.6");
  assert.equal(nextVersionLabel("2.0.5 · Schedules - edits"), "2.0.6");
  assert.equal(nextVersionLabel("2.0.9"), "2.0.10");
  assert.equal(nextVersionLabel("v1.09"), "v1.10");
  assert.equal(nextVersionLabel("Sprint 4"), "Sprint 5");
  assert.equal(nextVersionLabel("1.0-beta"), "1.1-beta");
  assert.equal(nextVersionLabel("Launch"), null);
  assert.equal(nextVersionLabel(null), null);
});

test("startsFromLatest hides the suggestion once the label already uses it", () => {
  assert.equal(startsFromLatest("", "2.0.5"), false);
  assert.equal(startsFromLatest("2.0.5 · Schedules", "2.0.5 · Home"), true);
  assert.equal(startsFromLatest("2.0.6", "2.0.5"), false);
  assert.equal(startsFromLatest("2.0.5", null), false);
});

test("finalizeVersionLabel drops only a dangling separator", () => {
  assert.equal(finalizeVersionLabel("2.0.5 · "), "2.0.5");
  assert.equal(finalizeVersionLabel("2.0.5 ·"), "2.0.5");
  assert.equal(finalizeVersionLabel("  2.0.5 · Schedules - edits  "), "2.0.5 · Schedules - edits");
  assert.equal(finalizeVersionLabel("1.0.0"), "1.0.0");
  assert.equal(finalizeVersionLabel(" · "), "");
});

test("releaseNotePreview flattens and shortens the note", () => {
  assert.equal(releaseNotePreview("  Check the\n\nschedule screens  "), "Check the schedule screens");
  const long = "a".repeat(120);
  const preview = releaseNotePreview(long, 20);
  assert.equal(preview.length, 20);
  assert.ok(preview.endsWith("…"));
});
