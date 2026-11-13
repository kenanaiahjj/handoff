import assert from "node:assert/strict";
import test from "node:test";
import { readPaintDetails, readTextStyleRuns } from "./text-style-runs.ts";

test("preserves each Figma text style run and its exact token bindings", () => {
  const runs = readTextStyleRuns(
    {
      textSegments: [
        {
          start: 0,
          end: 5,
          characters: "Hello",
          fontName: { family: "Inter", style: "Bold" },
          fontSize: 24,
          fontWeight: 700,
          lineHeight: { unit: "PIXELS", value: 32 },
          letterSpacing: { unit: "PERCENT", value: -2 },
          fills: [{ type: "SOLID", color: { r: 1, g: 0.5, b: 0 }, opacity: 0.5 }],
          textStyleId: "text-style-1",
          fillStyleId: "fill-style-1",
        },
        {
          start: 5,
          end: 11,
          characters: " world",
          fontName: { family: "Inter", style: "Regular" },
          fontSize: 16,
          fontWeight: 400,
          lineHeight: { unit: "PERCENT", value: 125 },
          letterSpacing: { unit: "PIXELS", value: 0.25 },
          fills: [{ type: "SOLID", color: { r: 0.2, g: 0.4, b: 0.6 } }],
        },
      ],
    },
    [
      {
        sourceId: "variable-color",
        bindingPath: "textSegments[0:5].fills.0",
        name: "brand.orange",
        category: "color",
        value: "#ff8000",
        collectionName: "Brand",
        mode: "Dark",
      },
      {
        sourceId: "variable-size",
        bindingPath: "textSegments[5:11].fontSize",
        name: "type.body",
        category: "typography",
        value: 16,
        collectionName: "Type",
        mode: "Desktop",
      },
      {
        sourceId: "unrelated-variable",
        bindingPath: "boundVariables.opacity",
        name: "opacity.page",
        category: "other",
        value: 1,
        collectionName: "Layout",
        mode: "Default",
      },
    ],
  );

  assert.equal(runs.length, 2);
  assert.deepEqual(
    runs.map((run) => ({
      characters: run.characters,
      fontFamily: run.fontFamily,
      fontStyle: run.fontStyle,
      fontSize: run.fontSize,
      fontWeight: run.fontWeight,
      lineHeight: run.lineHeight,
      letterSpacing: run.letterSpacing,
      fillColor: run.fills[0]?.color,
      fillOpacity: run.fills[0]?.opacity,
      tokens: run.tokens.map((token) => token.name),
    })),
    [
      {
        characters: "Hello",
        fontFamily: "Inter",
        fontStyle: "Bold",
        fontSize: 24,
        fontWeight: 700,
        lineHeight: "32px",
        letterSpacing: "-2%",
        fillColor: "#FF8000",
        fillOpacity: 0.5,
        tokens: ["brand.orange"],
      },
      {
        characters: " world",
        fontFamily: "Inter",
        fontStyle: "Regular",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: "125%",
        letterSpacing: "0.25px",
        fillColor: "#336699",
        fillOpacity: 1,
        tokens: ["type.body"],
      },
    ],
  );
});

test("ignores malformed or incomplete text style runs", () => {
  const runs = readTextStyleRuns({
    textSegments: [null, { start: 2, characters: "missing end" }, { end: 4, characters: "missing start" }],
  });

  assert.deepEqual(runs, []);
  assert.deepEqual(readTextStyleRuns({ textSegments: null }), []);
});

test("formats fractional Figma text metrics like the Figma inspector", () => {
  const [run] = readTextStyleRuns({
    textSegments: [{
      start: 0,
      end: 10,
      characters: "Departures",
      lineHeight: { unit: "PIXELS", value: 19.5 },
      letterSpacing: { unit: "PIXELS", value: 0.32499998807907104 },
    }],
  });

  assert.equal(run.lineHeight, "19.5px");
  assert.equal(run.letterSpacing, "0.32px");
});

test("preserves paint type, opacity, and gradient stop details", () => {
  const paints = readPaintDetails([
    {
      type: "GRADIENT_LINEAR",
      opacity: 0.75,
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 0.5 } },
        { position: 1, color: { r: 0, g: 0.5, b: 1 } },
      ],
    },
    { type: "SOLID", color: { r: 0.2, g: 0.4, b: 0.6, a: 0.5 }, opacity: 0.8 },
    { type: "IMAGE", opacity: 0.6, imageHash: "image-1" },
  ]);

  assert.deepEqual(paints, [
    {
      type: "GRADIENT_LINEAR",
      color: null,
      opacity: 0.75,
      gradientStops: [
        { position: 0, color: "#FF0000", opacity: 0.5 },
        { position: 1, color: "#0080FF", opacity: 1 },
      ],
    },
    {
      type: "SOLID",
      color: "#336699",
      opacity: 0.4,
      gradientStops: [],
    },
    {
      type: "IMAGE",
      color: null,
      opacity: 0.6,
      gradientStops: [],
    },
  ]);
});

test("reads normalized snapshot paint values when raw Figma data is unavailable", () => {
  assert.deepEqual(readPaintDetails([
    {
      color: "#336699",
      opacity: { value: 0.5, unit: "ratio", provenance: "source", sourceProperty: "fills[0].opacity" },
    },
  ]), [
    {
      type: "SOLID",
      color: "#336699",
      opacity: 0.5,
      gradientStops: [],
    },
  ]);
});
