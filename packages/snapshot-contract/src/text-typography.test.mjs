import assert from "node:assert/strict";
import test from "node:test";
import { typographyFromTextSegments } from "./text-typography.ts";

const measure = (value, unit = "px", sourceProperty = "test") => ({
  value,
  unit,
  provenance: value === null ? "unavailable" : "source",
  sourceProperty: value === null ? null : sourceProperty,
});

const fallbackTypography = {
  fontFamily: "Inter",
  fontSize: measure(13, "px", "fontSize"),
  fontWeight: 600,
  lineHeight: measure(20, "pixels", "lineHeight"),
  letterSpacing: measure(0, "pixels", "letterSpacing"),
  textAlign: "LEFT",
  content: "Departures",
};

test("uses uniform styled text segment values for exact typography summaries", () => {
  const typography = typographyFromTextSegments(fallbackTypography, {
    textSegments: [{
      fontName: { family: "Inter", style: "Semi Bold" },
      fontSize: 13,
      fontWeight: 600,
      lineHeight: { unit: "PIXELS", value: 19.5 },
      letterSpacing: { unit: "PIXELS", value: 0.32499998807907104 },
    }],
  });

  assert.equal(typography.fontFamily, "Inter");
  assert.equal(typography.fontSize.value, 13);
  assert.equal(typography.fontWeight, 600);
  assert.equal(typography.lineHeight.value, 19.5);
  assert.equal(typography.lineHeight.unit, "pixels");
  assert.equal(typography.letterSpacing.value, 0.32499998807907104);
  assert.equal(typography.letterSpacing.unit, "pixels");
});

test("uses mixed values for text properties that differ across styled runs", () => {
  const typography = typographyFromTextSegments(fallbackTypography, {
    textSegments: [
      {
        fontName: { family: "Inter", style: "Regular" },
        fontSize: 13,
        fontWeight: 400,
        lineHeight: { unit: "PIXELS", value: 19.5 },
        letterSpacing: { unit: "PIXELS", value: 0.25 },
      },
      {
        fontName: { family: "Roboto", style: "Bold" },
        fontSize: 16,
        fontWeight: 700,
        lineHeight: { unit: "PIXELS", value: 22 },
        letterSpacing: { unit: "PERCENT", value: 1.5 },
      },
    ],
  });

  assert.equal(typography.fontFamily, null);
  assert.equal(typography.fontSize.value, null);
  assert.equal(typography.fontWeight, null);
  assert.equal(typography.lineHeight.value, null);
  assert.equal(typography.letterSpacing.value, null);
  assert.equal(typography.letterSpacing.unit, "mixed");
});

test("keeps node-level typography when style segment values are absent", () => {
  assert.deepEqual(
    typographyFromTextSegments(fallbackTypography, { textSegments: [{ fontName: null }] }),
    fallbackTypography,
  );
});

test("treats partially missing run metrics as mixed instead of using a node-level value", () => {
  const typography = typographyFromTextSegments(fallbackTypography, {
    textSegments: [
      { lineHeight: { unit: "PIXELS", value: 19.5 } },
      { lineHeight: null },
    ],
  });

  assert.equal(typography.lineHeight.value, null);
  assert.equal(typography.lineHeight.provenance, "unavailable");
  assert.equal(typography.lineHeight.sourceProperty, null);
});
