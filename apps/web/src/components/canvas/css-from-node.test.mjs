import assert from "node:assert/strict";
import test from "node:test";
import { cssDifferences, cssTextForNode } from "./css-from-node.ts";

const m = (value, provenance = "source", unit = "px") => ({ value, unit, provenance: value === null ? "unavailable" : provenance, sourceProperty: null });
const none = { top: m(null), right: m(null), bottom: m(null), left: m(null) };

function node(overrides = {}) {
  return {
    sourceNodeId: "1:2", parentSourceNodeId: null, sourceFrameId: "1:1", name: "Button", type: "FRAME", visible: true,
    bounds: { x: m(0), y: m(0), width: m(343), height: m(48) },
    layout: { mode: null, direction: null, primaryAxisAlign: null, counterAxisAlign: null, wrap: null, constraints: {} },
    padding: none, margins: none, spacing: { rowGap: m(null), columnGap: m(null), itemGap: m(null) },
    fills: [], strokes: [], styleReferences: [], typography: null, tokens: [], sourcePayload: {},
    ...overrides,
  };
}

test("an auto layout button becomes flex CSS with only stored values", () => {
  const css = cssTextForNode(node({
    layout: { mode: "HORIZONTAL", direction: null, primaryAxisAlign: "CENTER", counterAxisAlign: "CENTER", wrap: false, constraints: {} },
    padding: { top: m(12), right: m(16), bottom: m(12), left: m(16) },
    spacing: { rowGap: m(null), columnGap: m(null), itemGap: m(8) },
    fills: [{ color: "#FF6A00", opacity: m(1, "source", "ratio"), sourceStyleId: null }],
    tokens: [{ sourceId: "t", bindingPath: "fills/0", category: "color", name: "brand/primary", collectionId: null, collectionName: null, mode: null, value: {} }],
    sourcePayload: { cornerRadius: 12, layoutSizingHorizontal: "FILL", layoutSizingVertical: "FIXED",
      effects: [{ type: "DROP_SHADOW", visible: true, radius: 8, spread: 0, offset: { x: 0, y: 2 }, color: { r: 0, g: 0, b: 0, a: 0.2 } }] },
  }));
  assert.equal(css, [
    "width: 100%;",
    "height: 48px;",
    "display: flex;",
    "flex-direction: row;",
    "justify-content: center;",
    "align-items: center;",
    "gap: 8px;",
    "padding: 12px 16px;",
    "border-radius: 12px;",
    "background: #FF6A00; /* brand/primary */",
    "box-shadow: 0 2px 8px 0 rgba(0, 0, 0, 0.2);",
  ].join("\n"));
});

test("measured sizes are left out and text gets font CSS", () => {
  const css = cssTextForNode(node({
    type: "TEXT",
    bounds: { x: m(0), y: m(0), width: m(120, "measured"), height: m(20) },
    fills: [{ color: "#1C1917", opacity: m(0.5, "source", "ratio"), sourceStyleId: null }],
    typography: { fontFamily: "Inter Display", fontSize: m(16), fontWeight: 600, lineHeight: m(150, "source", "PERCENT"), letterSpacing: m(-2, "source", "PERCENT"), textAlign: "CENTER", content: "Hi" },
  }));
  assert.equal(css, [
    "color: rgba(28, 25, 23, 0.5);",
    'font-family: "Inter Display";',
    "font-size: 16px;",
    "font-weight: 600;",
    "line-height: 150%;",
    "letter-spacing: -0.02em;",
    "text-align: center;",
  ].join("\n"));
});

test("differences list only the properties that differ", () => {
  const a = node({ sourcePayload: { cornerRadius: 8 } });
  const b = node({ bounds: { x: m(0), y: m(0), width: m(320), height: m(48) }, sourcePayload: { cornerRadius: 8 } });
  assert.deepEqual(cssDifferences(a, b), [{ property: "width", first: "343px", second: "320px" }]);
});
