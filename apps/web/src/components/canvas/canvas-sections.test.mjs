import assert from "node:assert/strict";
import test from "node:test";
import { canvasSectionsFromMetadata } from "./canvas-sections.ts";

test("sections are placed with their page offset in the overview's coordinates", () => {
  const sections = canvasSectionsFromMetadata({
    sourceMetadata: {
      sections: [
        { sourceSectionId: "s1", sourcePageId: "page-2", name: "Onboarding", x: 10, y: 20, width: 300, height: 200, fill: "#FFFFFF", frameIds: ["a"] },
        { sourceSectionId: "s2", sourcePageId: "page-2", name: "Gone", x: 0, y: 0, width: 100, height: 100, fill: null, frameIds: ["removed"] },
      ],
    },
    frameIds: new Set(["a"]),
    pageOffsets: new Map([["page-2", { offsetX: 1000, offsetY: 0 }]]),
    origin: { x: 500, y: -50 },
  });
  assert.deepEqual(sections, [{ id: "s1", name: "Onboarding", x: 510, y: 70, width: 300, height: 200, fill: "#FFFFFF" }]);
});

test("versions without sections draw none", () => {
  assert.deepEqual(canvasSectionsFromMetadata({ sourceMetadata: {}, frameIds: new Set(), pageOffsets: new Map(), origin: { x: 0, y: 0 } }), []);
});
