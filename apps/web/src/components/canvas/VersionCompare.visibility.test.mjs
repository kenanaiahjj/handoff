import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VersionCompare } from "./VersionCompare.tsx";

function compareMarkup() {
  const preview = {
    name: "Checkout",
    imageUrl: "/checkout.png",
    width: 393,
    height: 844,
    sourceWidth: 393,
    sourceHeight: 844,
    dimensionsSource: "design",
  };
  const frame = {
    frameId: "screen-1",
    beforeFrameId: "screen-1",
    afterFrameId: "screen-1",
    sourceFileId: "figma-file",
    name: "Checkout",
    status: "changed",
    before: preview,
    after: preview,
  };
  const result = {
    diff: {
      fromVersionId: "before",
      toVersionId: "after",
      sourceIdentity: "exact",
      captureScopeComparison: null,
      frames: [frame],
      changes: [],
      captureCoverage: [],
      unmatchedFrameCandidates: [{
        sourceFileId: "figma-file",
        beforeFrameId: "old-checkout-screen",
        beforeName: "Checkout",
        afterCandidates: [{ frameId: "screen-1", name: "Checkout", score: 1 }],
        totalCandidates: 1,
        candidatesTruncated: false,
      }],
      unmatchedNodeCandidates: [{
        sourceFileId: "figma-file",
        frameId: "screen-1",
        beforeFrameId: "screen-1",
        afterFrameId: "screen-1",
        beforeNodeId: "before-layer",
        beforeName: "Container",
        afterCandidates: [{ sourceNodeId: "after-layer", name: "Container", type: "FRAME", score: 1 }],
        totalCandidates: 1,
        candidatesTruncated: false,
      }],
    },
    frames: [frame],
  };
  return renderToStaticMarkup(createElement(VersionCompare, {
    versions: [
      { id: "before", versionLabel: "Before", releaseNote: null, createdAt: "2026-11-10T00:00:00.000Z" },
      { id: "after", versionLabel: "After", releaseNote: null, createdAt: "2026-11-11T00:00:00.000Z" },
    ],
    selectedVersionId: "after",
    compareEndpointBase: "/compare",
    initialRouteState: { fromVersionId: "before", toVersionId: "after", frameId: "screen-1", mode: "side-by-side" },
    initialResult: result,
    compareScreenRequest: null,
    onComparisonChange() {},
    onComparisonFrameSelect() {},
    onRouteStateChange() {},
    onClose() {},
  }));
}

test("shows before and after screens without match review prompts", () => {
  const markup = compareMarkup();
  assert.match(markup, /alt="Before: Checkout"/);
  assert.match(markup, /alt="After: Checkout"/);
  assert.doesNotMatch(markup, /Review possible layer matches|Possible layer matches|Confirm layer matches/);
  assert.doesNotMatch(markup, /Confirm screen matches|Choose from 1 matching screen|Confirm match/);
});
