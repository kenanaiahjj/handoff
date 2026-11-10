import assert from "node:assert/strict";
import test from "node:test";
import { layoutCommentPins } from "./comment-pin-layout.ts";

function comment(id, frameId, x, y, { parentCommentId = null, resolvedAt = null, sourceNodeId = null } = {}) {
  return { id, frameId, x, y, parentCommentId, resolvedAt, sourceNodeId, body: id };
}

test("maps saved screen-relative comments into overview coordinates without scaling the source point", () => {
  const comments = [comment("pin-1", "screen-1", 12.5, 30.25)];
  const screens = [{ id: "screen-1", sourceX: 40, sourceY: 80 }];
  const overviewOrigin = { sourceX: -100, sourceY: 20 };
  const pins = layoutCommentPins(comments, screens, overviewOrigin, false);

  assert.equal(pins[0].comment.x, 152.5);
  assert.equal(pins[0].comment.y, 90.25);
});

test("keeps saved screen-relative coordinates when viewing that screen directly", () => {
  const pins = layoutCommentPins(
    [comment("pin-1", "screen-1", 12.5, 30.25)],
    [{ id: "screen-1", sourceX: 40, sourceY: 80 }],
    { sourceX: 40, sourceY: 80 },
    false,
  );

  assert.deepEqual({ x: pins[0].comment.x, y: pins[0].comment.y }, { x: 12.5, y: 30.25 });
});

test("maps canvas and screen pins into the visible overview viewport after a pan", () => {
  const comments = [
    comment("canvas-pin", "__overview__", 40, 50),
    comment("layer-pin", "screen-1", 12, 30, { sourceNodeId: "button-1" }),
  ];
  const screens = [{ id: "screen-1", kind: "frame", sourceX: 200, sourceY: 300, sourceWidth: 320, sourceHeight: 640 }];
  const viewport = { id: "__overview__", kind: "overview", sourceX: 120, sourceY: 220, sourceWidth: 500, sourceHeight: 400 };
  const pins = layoutCommentPins(comments, screens, viewport, false, { sourceX: 100, sourceY: 200 });

  assert.deepEqual(pins.map(({ comment: pin }) => ({
    id: pin.id,
    x: pin.x,
    y: pin.y,
    sourceNodeId: pin.sourceNodeId,
  })), [
    { id: "canvas-pin", x: 20, y: 30, sourceNodeId: null },
    { id: "layer-pin", x: 92, y: 110, sourceNodeId: "button-1" },
  ]);
});

test("shows only root pins with coordinates and respects the resolved-pin setting", () => {
  const comments = [
    comment("open", "screen-1", 1, 2),
    comment("resolved", "screen-1", 3, 4, { resolvedAt: "2026-11-09T00:00:00.000Z" }),
    comment("reply", "screen-1", 5, 6, { parentCommentId: "open" }),
    comment("unplaced", "screen-1", null, null),
  ];
  const screens = [{ id: "screen-1", sourceX: 0, sourceY: 0 }];

  assert.deepEqual(layoutCommentPins(comments, screens, { sourceX: 0, sourceY: 0 }, false).map(({ comment: pin }) => pin.id), ["open"]);
  assert.deepEqual(layoutCommentPins(comments, screens, { sourceX: 0, sourceY: 0 }, true).map(({ comment: pin }) => pin.id), ["open", "resolved"]);
});
