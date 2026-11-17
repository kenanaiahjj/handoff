import assert from "node:assert/strict";
import test from "node:test";
import { pageCaptureChoice } from "../src/capture-merge.ts";

const frames = (pageId, count) => Array.from({ length: count }, () => ({ sourcePageId: pageId }));

test("capturing a new page over a one-page handoff suggests replacing it (a duplicated design revision)", () => {
  assert.deepEqual(
    pageCaptureChoice({ scope: "page", baselineFrames: frames("2.0.4", 208), incomingFrames: frames("2.0.5", 210) }),
    { capturedPageIds: ["2.0.5"], baselinePageIds: ["2.0.4"], retainedFrameCount: 208, suggested: "replace" },
  );
});

test("adding a new page to a multi-page handoff suggests keeping the other pages", () => {
  const choice = pageCaptureChoice({ scope: "page", baselineFrames: [...frames("a", 3), ...frames("b", 2)], incomingFrames: frames("c", 4) });
  assert.equal(choice.suggested, "add");
  assert.equal(choice.retainedFrameCount, 5);
});

test("no choice when the page is already in the handoff, or the capture is not a page capture", () => {
  assert.equal(pageCaptureChoice({ scope: "page", baselineFrames: frames("a", 3), incomingFrames: frames("a", 3) }), null);
  assert.equal(pageCaptureChoice({ scope: "selected", baselineFrames: frames("a", 3), incomingFrames: frames("b", 1) }), null);
  assert.equal(pageCaptureChoice({ scope: "file", baselineFrames: frames("a", 3), incomingFrames: frames("b", 1) }), null);
  assert.equal(pageCaptureChoice({ scope: "page", baselineFrames: [], incomingFrames: frames("b", 1) }), null);
});
