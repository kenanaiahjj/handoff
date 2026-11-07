import assert from "node:assert/strict";
import test from "node:test";
import { formatTaskDesignContext, resolveTaskDesignContext, taskCanvasHref, taskLinkSchema } from "./task-context.ts";

const measure = (value) => ({ value, unit: "px", provenance: "source", sourceProperty: "test" });
const frameBounds = { x: measure(0), y: measure(0), width: measure(390), height: measure(844) };
const element = {
  sourceNodeId: "button-1",
  sourceFrameId: "welcome",
  name: "Continue",
  type: "INSTANCE",
  bounds: { x: measure(24), y: measure(700), width: measure(342.25), height: measure(48) },
  layout: { mode: "HORIZONTAL", direction: "ROW", primaryAxisAlign: null, counterAxisAlign: null, wrap: false, constraints: {} },
  padding: { top: measure(12), right: measure(16), bottom: measure(12), left: measure(16) },
  margins: { top: measure(0), right: measure(24), bottom: measure(16), left: measure(24) },
  spacing: { rowGap: measure(0), columnGap: measure(0), itemGap: measure(8) },
  fills: [{ color: "#315C46" }],
  strokes: [],
  styleReferences: [],
  typography: { fontFamily: "Inter", fontSize: measure(14), fontWeight: 500, lineHeight: measure(20), letterSpacing: measure(0), textAlign: "CENTER", content: null },
  tokens: [{ name: "color/action/primary", value: "#315C46" }],
};
const structuredSnapshot = {
  frames: [{ sourceFrameId: "welcome", name: "Welcome", bounds: frameBounds, nodes: [element] }],
};

test("resolves a selected screen and element with captured layout and token evidence", () => {
  assert.deepEqual(resolveTaskDesignContext(structuredSnapshot, "welcome", "button-1"), {
    frame: { sourceFrameId: "welcome", name: "Welcome", bounds: frameBounds },
    element: {
      sourceNodeId: "button-1",
      name: "Continue",
      type: "INSTANCE",
      bounds: element.bounds,
      layout: element.layout,
      padding: element.padding,
      margins: element.margins,
      spacing: element.spacing,
      fills: element.fills,
      strokes: element.strokes,
      styleReferences: element.styleReferences,
      typography: element.typography,
      tokens: element.tokens,
    },
  });
});

test("formats a deep link and readable layout summary for a task description", () => {
  const context = resolveTaskDesignContext(structuredSnapshot, "welcome", "button-1");
  const href = taskCanvasHref("https://handoff.example/review/share?versionId=version-1", context);
  const description = formatTaskDesignContext(context, href);

  assert.equal(href, "https://handoff.example/review/share?versionId=version-1#screen=welcome&element=button-1");
  assert.match(description, /Screen: Welcome \(frame ID: welcome\)/);
  assert.match(description, /Bounds: x 24 px, y 700 px, width 342\.5 px, height 48 px/);
  assert.match(description, /Padding: top 12 px, right 16 px, bottom 12 px, left 16 px/);
  assert.match(description, /Tokens: color\/action\/primary = #315C46/);
  assert.match(description, /Canvas: https:\/\/handoff\.example\/review\/share\?versionId=version-1#screen=welcome&element=button-1/);
});

test("rejects an element without a selected screen", () => {
  assert.throws(
    () => resolveTaskDesignContext(structuredSnapshot, null, "button-1"),
    /screen.*element/i,
  );
});

test("rejects screen and element IDs that are not in the frozen snapshot", () => {
  assert.throws(() => resolveTaskDesignContext(structuredSnapshot, "missing", null), /screen.*version/i);
  assert.throws(() => resolveTaskDesignContext(structuredSnapshot, "welcome", "missing"), /element.*screen/i);
});

test("allows an image-only screen reference but rejects an element reference", () => {
  const imageOnlySnapshot = {
    visualOnly: true,
    frames: [{ sourceFrameId: "image-upload-frame", name: "Screenshot.png", renderAssetKey: "overview" }],
  };
  assert.deepEqual(resolveTaskDesignContext(imageOnlySnapshot, "image-upload-frame", null), {
    frame: { sourceFrameId: "image-upload-frame", name: "Screenshot.png", bounds: null },
    element: null,
  });
  assert.throws(
    () => resolveTaskDesignContext(imageOnlySnapshot, "image-upload-frame", "button-1"),
    /visual-only.*element/i,
  );
});

test("keeps generic version-wide task creation valid", () => {
  assert.equal(resolveTaskDesignContext(structuredSnapshot, null, null), null);
});

test("accepts an external task reference and rejects missing or unsafe references", () => {
  const base = { title: "Fix the primary action", externalTaskId: "CU-123" };
  assert.equal(taskLinkSchema.safeParse(base).success, true);
  assert.equal(taskLinkSchema.safeParse({ title: "No destination" }).success, false);
  assert.equal(taskLinkSchema.safeParse({ ...base, externalUrl: "javascript:alert(1)" }).success, false);
  assert.equal(taskLinkSchema.safeParse({ ...base, externalUrl: "https://user:pass@clickup.com/task/123" }).success, false);
});
