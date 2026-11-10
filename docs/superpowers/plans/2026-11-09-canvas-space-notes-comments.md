# Canvas-space notes and comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Let users place notes and comments on frame points and empty canvas points while keeping frame anchors stable.

**Architecture:** Introduce a shared canvas anchor utility that converts click coordinates to either frame-relative or overview-relative anchors and converts saved anchors back into the active viewport. Reuse the `__overview__` sentinel and existing comment storage, add matching validation for annotations, and keep permissions and per-version records unchanged.

**Tech Stack:** Next.js, React, TypeScript, Node test runner, Zod, SQLite.

## Global constraints

- A point inside a screen frame is stored relative to that frame.
- A point outside every visible screen frame is stored relative to the canvas overview with the existing `__overview__` frame ID sentinel.
- Canvas-space pins remain attached to canvas coordinates when users pan or zoom. They are scoped to the selected immutable version like current notes and comments.
- If a user clicks a layer while placing a comment or note, link the pin to that layer. A previously selected layer is not linked when the user clicks elsewhere.
- Canvas-space pins render on the overview at their stored position. When a frame view is active, render them only when their canvas coordinates fall inside that view.
- Reuse the existing `frame_id`, `x`, and `y` fields. No database migration is required.
- Preserve existing authorization, version scoping, thread replies, frame-point validation, and frame-anchored records.

---

## File map

- Create `apps/web/src/components/canvas/canvas-anchor.ts` for converting viewport clicks into saved anchors and saved anchors into viewport positions.
- Create `apps/web/src/components/canvas/canvas-anchor.test.mjs` for frame, overview, bounds, and viewport conversion cases.
- Update `apps/web/src/components/comments/comment-pin-layout.ts` to lay out both anchor types and add `apps/web/src/components/comments/comment-pin-layout.test.mjs`.
- Update `apps/web/src/components/canvas/CanvasViewport.tsx` to place and render both anchor types.
- Update `apps/web/src/components/canvas/HandoffCanvas.tsx` to pass the overview origin and keep the overview active when a canvas-space pin is selected.
- Update `apps/web/src/components/comments/CommentThread.tsx` and `apps/web/src/components/canvas/CanvasAnnotationsPanel.tsx` to describe and label canvas-space points.
- Create `apps/web/src/server/services/canvas-annotation-anchor.ts` for shared annotation-point validation and `apps/web/src/server/services/canvas-annotation-anchor.test.mjs` for bounds and layer-link checks.
- Update authenticated and review annotation POST routes to use the shared validator.

## Task 1: Add shared anchor conversion

**Files:**

- Create: `apps/web/src/components/canvas/canvas-anchor.ts`
- Create: `apps/web/src/components/canvas/canvas-anchor.test.mjs`

**Interfaces:**

- Produce `CanvasAnchorPoint` with `frameId`, `sourceNodeId`, `x`, and `y` fields.
- Produce `overviewCanvasFrameId` with the existing value `"__overview__"`.
- Produce `canvasAnchorAtPoint(viewportFrame, screens, point, sourceNodeId)` to return a frame-relative point, overview-relative point, or `null` when the point is outside the visible coordinate surface.
- Produce `canvasAnchorToViewportPoint(anchor, viewportFrame, screens, overviewOrigin)` to convert a saved anchor into active viewport coordinates or `null` when it is outside the active view.

- [ ] **Step 1: Write anchor conversion tests**

Add tests for these exact behaviors:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { canvasAnchorAtPoint, canvasAnchorToViewportPoint, overviewCanvasFrameId } from "./canvas-anchor.ts";

const overview = { id: overviewCanvasFrameId, kind: "overview", sourceX: 100, sourceY: 50, sourceWidth: 500, sourceHeight: 600 };
const home = { id: "home", kind: "frame", sourceX: 110, sourceY: 70, sourceWidth: 100, sourceHeight: 200 };
const activeFrame = { id: "active", kind: "frame", sourceX: 190, sourceY: 90, sourceWidth: 100, sourceHeight: 200 };
const origin = { sourceX: overview.sourceX, sourceY: overview.sourceY };

test("stores a click on a frame in frame-local coordinates", () => {
  const anchor = canvasAnchorAtPoint(
    overview,
    [home],
    { x: 30, y: 40 },
    "clicked-layer",
  );
  assert.deepEqual(anchor, { frameId: "home", sourceNodeId: "clicked-layer", x: 20, y: 20 });
  assert.deepEqual(
    canvasAnchorAtPoint(home, [home], { x: 25, y: 35 }, null),
    { frameId: "home", sourceNodeId: null, x: 25, y: 35 },
  );
});

test("stores an empty overview click in canvas coordinates without a layer link", () => {
  const anchor = canvasAnchorAtPoint(
    overview,
    [home],
    { x: 5, y: 6 },
    "previously-selected-layer",
  );
  assert.deepEqual(anchor, { frameId: overviewCanvasFrameId, sourceNodeId: null, x: 5, y: 6 });
});

test("rejects clicks outside the active viewport and blank points in a frame-only viewport", () => {
  assert.equal(canvasAnchorAtPoint(overview, [home], { x: 501, y: 10 }, null), null);
  assert.equal(canvasAnchorAtPoint(activeFrame, [home], { x: 5, y: 5 }, null), null);
});

test("maps a canvas anchor into an active frame view and hides off-view points", () => {
  assert.deepEqual(
    canvasAnchorToViewportPoint({ frameId: overviewCanvasFrameId, sourceNodeId: null, x: 110, y: 70 }, activeFrame, [home], origin),
    { x: 20, y: 30 },
  );
  assert.equal(
    canvasAnchorToViewportPoint({ frameId: overviewCanvasFrameId, sourceNodeId: null, x: 400, y: 400 }, activeFrame, [home], origin),
    null,
  );
});
```

- [ ] **Step 2: Run the anchor tests and confirm they fail because the utility is missing**

Run: `node --experimental-transform-types --test apps/web/src/components/canvas/canvas-anchor.test.mjs`

Expected: the test file fails to import `canvas-anchor.ts`.

- [ ] **Step 3: Implement the anchor utility**

Use this implementation shape and preserve these signatures:

```ts
export const overviewCanvasFrameId = "__overview__";

export type CanvasAnchorFrame = {
  id: string;
  kind: "overview" | "frame";
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
};

export type CanvasAnchorPoint = {
  frameId: string;
  sourceNodeId: string | null;
  x: number;
  y: number;
};

export function canvasAnchorAtPoint(
  viewportFrame: CanvasAnchorFrame,
  screens: readonly CanvasAnchorFrame[],
  point: { x: number; y: number },
  sourceNodeId: string | null,
): CanvasAnchorPoint | null;

export function canvasAnchorToViewportPoint(
  anchor: CanvasAnchorPoint,
  viewportFrame: CanvasAnchorFrame,
  screens: readonly CanvasAnchorFrame[],
  overviewOrigin: { sourceX: number; sourceY: number },
): { x: number; y: number } | null;
```

`canvasAnchorAtPoint` must reject non-finite or out-of-bounds local coordinates; use frame-local coordinates when the translated point intersects a screen; use `__overview__` and local overview coordinates when the current viewport is an overview and the point intersects no screen; and return `null` for empty points in a frame-only viewport. Set `sourceNodeId` to `null` for overview anchors.

`canvasAnchorToViewportPoint` must translate frame-local points through their screen origin, translate overview-local points through `overviewOrigin`, subtract the active viewport origin, and return `null` outside the active viewport bounds.

- [ ] **Step 4: Run the anchor tests and confirm they pass**

Run: `node --experimental-transform-types --test apps/web/src/components/canvas/canvas-anchor.test.mjs`

Expected: all anchor conversion tests pass.

## Task 2: Place and render both pin types

**Files:**

- Modify: `apps/web/src/components/canvas/CanvasViewport.tsx`
- Modify: `apps/web/src/components/canvas/HandoffCanvas.tsx`
- Modify: `apps/web/src/components/comments/CommentThread.tsx`
- Modify: `apps/web/src/components/comments/comment-pin-layout.ts`
- Modify: `apps/web/src/components/canvas/CanvasAnnotationsPanel.tsx`
- Create: `apps/web/src/components/comments/comment-pin-layout.test.mjs`

**Interfaces:**

- Consume `CanvasAnchorPoint`, `overviewCanvasFrameId`, `canvasAnchorAtPoint`, and `canvasAnchorToViewportPoint` from Task 1.
- Add an `overviewOrigin: { sourceX: number; sourceY: number }` prop to `CanvasViewport`.
- Use `CanvasAnchorPoint` in comment and annotation placement callbacks.
- Extend `layoutCommentPins(comments, screens, viewportFrame, showResolvedPins, overviewOrigin)` so it maps both anchor types to active viewport coordinates.

- [ ] **Step 1: Write pin layout tests**

Add these fixtures and cases to `comment-pin-layout.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { layoutCommentPins } from "./comment-pin-layout.ts";

const overview = { sourceX: 100, sourceY: 50, sourceWidth: 500, sourceHeight: 600 };
const origin = { sourceX: 100, sourceY: 50 };
const home = { id: "home", sourceX: 110, sourceY: 70, sourceWidth: 100, sourceHeight: 200 };
const focused = { sourceX: 290, sourceY: 280, sourceWidth: 100, sourceHeight: 200 };
const comment = (id, frameId, x, y) => ({ id, frameId, parentCommentId: null, x, y, resolvedAt: null });

test("lays out frame and overview pins in the overview", () => {
  const pins = layoutCommentPins([
    comment("frame-comment", "home", 20, 30),
    comment("canvas-comment", "__overview__", 300, 300),
  ], [home], overview, true, origin);
  assert.deepEqual(pins.map(({ comment: item }) => [item.id, item.x, item.y]), [
    ["frame-comment", 30, 50],
    ["canvas-comment", 300, 300],
  ]);
});

test("shows an overview pin in a frame view only when its canvas point is inside", () => {
  const pins = layoutCommentPins([
    comment("inside", "__overview__", 200, 250),
    comment("outside", "__overview__", 400, 400),
  ], [home], focused, true, origin);
  assert.deepEqual(pins.map(({ comment: item }) => [item.id, item.x, item.y]), [["inside", 10, 20]]);
});
```

- [ ] **Step 2: Run the pin layout tests and confirm they fail for overview anchors**

Run: `node --experimental-transform-types --test apps/web/src/components/comments/comment-pin-layout.test.mjs`

Expected: the test for the `__overview__` anchor fails because `layoutCommentPins` currently drops anchors that do not match a screen.

- [ ] **Step 3: Wire click placement and viewport rendering**

In `CanvasViewport.handleCanvasClick`, use this branch after converting the click to local viewport coordinates:

```ts
const anchor = canvasAnchorAtPoint(
  frame,
  screens,
  { x: localX, y: localY },
  nodeButton?.dataset.sourceNodeId ?? null,
);
if (commentMode) {
  if (anchor) onPlaceComment(anchor);
  return;
}
if (annotationMode) {
  if (anchor) onPlaceAnnotation(anchor);
  return;
}
```

Do not use `selectedNodeId` as a fallback for a click that did not hit a layer.

Pass `overviewOrigin={{ sourceX: overviewFrame.sourceX, sourceY: overviewFrame.sourceY }}` from `HandoffCanvas` to `CanvasViewport`. In `HandoffCanvas`, keep the overview visible when the local or linked frame ID is `overviewCanvasFrameId`, including when a canvas-space comment or annotation is selected.

Update `layoutCommentPins` and annotation pin positioning to call `canvasAnchorToViewportPoint`. Keep existing pin components and version scoping. Add `screenNames.__overview__ = "Canvas"`; label overview anchors as `Canvas` in the comment thread and note panel. Use these placement hints: `Click a frame or empty canvas point to place a comment pin.` and `Click a frame or empty canvas point to place a canvas note.`

- [ ] **Step 4: Run placement and layout tests**

Run: `node --experimental-transform-types --test apps/web/src/components/canvas/canvas-anchor.test.mjs apps/web/src/components/comments/comment-pin-layout.test.mjs`

Expected: frame and canvas points map correctly; pins outside the active viewport are omitted.

## Task 3: Validate canvas-space notes on both API routes

**Files:**

- Create: `apps/web/src/server/services/canvas-annotation-anchor.ts`
- Create: `apps/web/src/server/services/canvas-annotation-anchor.test.mjs`
- Modify: `apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/versions/[versionId]/annotations/route.ts`
- Modify: `apps/web/app/api/review/[shareId]/versions/[versionId]/annotations/route.ts`

**Interfaces:**

- Produce `canvasAnnotationAnchorError(snapshot, input): string | null`.
- Preserve the existing parsed annotation payload and repository input shape.
- Consume `overviewCanvasFrameId` semantics from Task 1 by comparing against the literal `"__overview__"` on the server; do not import a client component module into server code.

- [ ] **Step 1: Write validator tests**

Add these fixtures and cases to `canvas-annotation-anchor.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { canvasAnnotationAnchorError } from "./canvas-annotation-anchor.ts";

const snapshot = {
  overviewAssetKey: "overview",
  canvasBounds: { width: { value: 500 }, height: { value: 600 } },
  assets: [
    { key: "overview", width: 500, height: 600 },
    { key: "home-render", width: 100, height: 200 },
  ],
  frames: [{
    sourceFrameId: "home",
    renderAssetKey: "home-render",
    bounds: { width: { value: 100 }, height: { value: 200 } },
    nodes: [{ sourceNodeId: "button" }],
  }],
};
const point = (frameId, sourceNodeId, x, y) => ({ frameId, sourceNodeId, x, y });

test("accepts valid frame and canvas annotation points", () => {
  assert.equal(canvasAnnotationAnchorError(snapshot, point("home", "button", 20, 30)), null);
  assert.equal(canvasAnnotationAnchorError(snapshot, point("__overview__", null, 300, 400)), null);
  assert.equal(canvasAnnotationAnchorError({ ...snapshot, canvasBounds: null }, point("__overview__", null, 300, 400)), null);
});

test("rejects invalid canvas bounds, canvas layer links, and frame anchors", () => {
  assert.match(canvasAnnotationAnchorError(snapshot, point("__overview__", null, 501, 20)), /canvas bounds/);
  assert.match(canvasAnnotationAnchorError(snapshot, point("__overview__", null, 20, 601)), /canvas bounds/);
  assert.match(canvasAnnotationAnchorError(snapshot, point("__overview__", "button", 20, 20)), /cannot be linked/);
  assert.match(canvasAnnotationAnchorError(snapshot, point("missing", null, 1, 1)), /Choose a screen/);
  assert.match(canvasAnnotationAnchorError(snapshot, point("home", null, 101, 20)), /screen bounds/);
  assert.match(canvasAnnotationAnchorError(snapshot, point("home", "missing", 20, 20)), /selected layer/);
});
```

- [ ] **Step 2: Run validator tests and confirm they fail because the shared helper is missing**

Run: `node --experimental-transform-types --test apps/web/src/server/services/canvas-annotation-anchor.test.mjs`

Expected: the test file fails to import `canvas-annotation-anchor.ts`.

- [ ] **Step 3: Implement and use the shared validator**

Implement this validator shape, using the snapshot's existing `SnapshotEnvelope` types:

```ts
export function canvasAnnotationAnchorError(
  snapshot: SnapshotEnvelope,
  input: { frameId: string; sourceNodeId: string | null; x: number; y: number },
): string | null {
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) return "The annotation point is outside the canvas bounds.";
  if (input.frameId === "__overview__") {
    if (input.sourceNodeId) return "A canvas point cannot be linked to a layer.";
    const overview = snapshot.assets.find((asset) => asset.key === snapshot.overviewAssetKey);
    const width = snapshot.canvasBounds?.width.value ?? overview?.width ?? null;
    const height = snapshot.canvasBounds?.height.value ?? overview?.height ?? null;
    if (width === null || height === null || input.x < 0 || input.y < 0 || input.x > width || input.y > height) {
      return "The annotation point is outside the canvas bounds.";
    }
    return null;
  }
  const frame = snapshot.frames.find((candidate) => candidate.sourceFrameId === input.frameId);
  if (!frame) return "Choose a screen in this version.";
  const width = frame.bounds.width.value;
  const height = frame.bounds.height.value;
  if (width === null || height === null || input.x < 0 || input.y < 0 || input.x > width || input.y > height) {
    return "The annotation point is outside the screen bounds.";
  }
  if (input.sourceNodeId && !frame.nodes.some((node) => node.sourceNodeId === input.sourceNodeId)) {
    return "The selected layer is not in this screen.";
  }
  return null;
}
```

In each annotation POST route, call `canvasAnnotationAnchorError(version.snapshot, parsed.data)` after `createSchema.safeParse`; return its message with status 400 when non-null. For frame anchors, preserve the current frame, bounds, and node checks and their current error text.

Call the helper from both annotation POST routes after `createSchema.safeParse`. Return its error with status 400 when it returns a message. Keep the current authentication, review-access, and structured-snapshot checks in place. Do not change comments routes; they already validate `__overview__` points.

- [ ] **Step 4: Run validator tests and confirm they pass**

Run: `node --experimental-transform-types --test apps/web/src/server/services/canvas-annotation-anchor.test.mjs`

Expected: valid canvas and frame points pass; invalid points return the expected validation errors.

## Task 4: Run integration checks

**Files:** all files in Tasks 1–3.

- [ ] **Step 1: Run all new anchor tests**

Run: `node --experimental-transform-types --test apps/web/src/components/canvas/canvas-anchor.test.mjs apps/web/src/components/comments/comment-pin-layout.test.mjs apps/web/src/server/services/canvas-annotation-anchor.test.mjs`

Expected: all new geometry and validation tests pass.

- [ ] **Step 2: Run web lint**

Run: `npm run lint --workspace @asbir/web`

Expected: ESLint reports no errors in the app.

- [ ] **Step 3: Build the web app**

Run: `npm run build --workspace @asbir/web`

Expected: Next.js compiles and type-checks the updated canvas and API routes.

- [ ] **Step 4: Review only the feature diff**

Run: `git diff --check`

Expected: no whitespace errors; existing unrelated worktree changes remain untouched.
