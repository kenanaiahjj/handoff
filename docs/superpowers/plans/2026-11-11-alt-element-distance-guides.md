# Alt element distance guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show in-canvas pixel guides between a selected layer and a hovered layer while the user holds Alt.

**Architecture:** Extract rectangle-gap geometry into a small pure helper. In `CanvasViewport`, convert selected and hovered bounds into the active frame's local coordinates, then render the helper's guide segments as a non-interactive SVG inside the already transformed design plane. Use inverse zoom for label text so source-pixel measurements stay readable.

**Tech Stack:** Next.js, React, TypeScript, SVG.

## Global Constraints

- In Inspect mode, keep one element selected and hold Alt while pointing at another captured element.
- Show in-canvas guide lines and pixel labels for positive horizontal and vertical edge gaps.
- Measure in captured design pixels, independent of canvas zoom.
- Support both an individual frame view and the overview canvas.
- Keep View mode and other pointer interactions unchanged.
- Reuse captured layer bounds; do not change capture data, persistence, APIs, or frame selection.

---

## File map

- Create `apps/web/src/components/canvas/element-distance-guides.ts` for finite rectangle validation and nearest-edge measurement geometry.
- Modify `apps/web/src/components/canvas/CanvasViewport.tsx` to map bounds into viewport-local coordinates, render guides in SVG, and remove the corner-only distance chip.
- Modify `apps/web/src/components/canvas/ElementInspector.tsx` to tell users to select an element, hold Alt, and hover another element for in-canvas pixel distances.

## Task 1: Add pure gap geometry

**Files:**

- Create: `apps/web/src/components/canvas/element-distance-guides.ts`

**Interfaces:**

- Accept `ElementRect = { x: number; y: number; width: number; height: number }`.
- Return `ElementDistanceGuide[]`; each guide has an `axis`, `distance`, a measured line segment, zero or more extension segments, and a label point.
- Return an empty array for non-finite coordinates, non-positive rectangle dimensions, or rectangles with no positive edge gap on either axis.

- [x] **Step 1: Define the helper types and function**

```ts
export type ElementRect = { x: number; y: number; width: number; height: number };
export type GuideSegment = { x1: number; y1: number; x2: number; y2: number };
export type ElementDistanceGuide = {
  axis: "horizontal" | "vertical";
  distance: number;
  segment: GuideSegment;
  extensions: GuideSegment[];
  labelX: number;
  labelY: number;
};

export function getElementDistanceGuides(first: ElementRect, second: ElementRect): ElementDistanceGuide[];
```

- [x] **Step 2: Implement horizontal edge gaps**

Compute `firstRight = first.x + first.width`, `secondRight = second.x + second.width`, and `horizontalGap = Math.max(0, second.x - firstRight, first.x - secondRight)`. If the gap is positive, connect the two nearest left/right edges. Put the line at the center of the vertical overlap when it exists; otherwise put it halfway between the rectangles' vertical centers and add vertical extension segments from each rectangle center to the measured line. Place the label at the segment midpoint, above the line.

- [x] **Step 3: Implement vertical edge gaps and input checks**

Compute `firstBottom = first.y + first.height`, `secondBottom = second.y + second.height`, and `verticalGap = Math.max(0, second.y - firstBottom, first.y - secondBottom)`. If the gap is positive, connect the nearest top/bottom edges. Put the line at the center of the horizontal overlap when it exists; otherwise put it halfway between the rectangles' horizontal centers and add horizontal extension segments from each rectangle center to the measured line. Place the label at the segment midpoint, to the right of the line. Before measuring, return `[]` if any rectangle value is non-finite or either rectangle has width or height `<= 0`.

## Task 2: Render guides in the canvas

**Files:**

- Modify: `apps/web/src/components/canvas/CanvasViewport.tsx`
- Modify: `apps/web/src/components/canvas/ElementInspector.tsx`

**Interfaces:**

- Consume `getElementDistanceGuides` and its `ElementRect` type from Task 1.
- Use `selectedNodeId`, `hoveredNodeId`, and captured node bounds already available in `CanvasViewport`.

- [x] **Step 1: Convert node bounds into the active design plane**

Use the existing selected and hovered node bounds. Require finite x, y, width, and height values. For overview mode, subtract `frame.sourceX` and `frame.sourceY` from each node's x and y; frame mode already uses frame-local coordinates.

- [x] **Step 2: Build guides only for the active Alt comparison**

Call `getElementDistanceGuides` only when Alt is held, both node IDs exist, the selected and hovered IDs differ, and both bounds are complete. Keep the existing Inspect-only hover tracking so View mode remains unchanged. Clear the hovered ID when `frame.id` changes so a frame switch cannot leave stale measurements.

- [x] **Step 3: Render an SVG guide layer in the transformed canvas**

Render each measured segment and its extension segments in an `aria-hidden`, `pointer-events-none` SVG inside the design-plane wrapper. Match Figma's red measurement guides with small red value badges, `vector-effect="non-scaling-stroke"`, and inverse-scaled badge and text sizes. Show numeric values in the badges without a unit suffix; announce the unit as pixels in the visually hidden `aria-live="polite"` region. Keep fractional distances to one decimal place.

- [x] **Step 4: Remove the old corner readout**

Delete the `distance` chip that displays `Δ x · y` in the viewport corner. In the inspector hint, replace `Hold Alt and point at another element for the distance between them.` with `Hold Alt and hover another element to see pixel distances in the canvas.`

## Task 3: Run focused static checks

**Files:** Task 1 and Task 2 files.

- [x] **Step 1: Run ESLint on the changed canvas files**

Run from the repository root:

```bash
npm exec --workspace @asbir/web -- eslint src/components/canvas/element-distance-guides.ts src/components/canvas/CanvasViewport.tsx src/components/canvas/ElementInspector.tsx
```

Expected: ESLint exits with code 0 and reports no errors.

- [x] **Step 2: Run a scoped TypeScript check without generated `.next` route types**

Create `/tmp/asbir-alt-distance-tsconfig.json` with this content so the check does not load stale generated Next.js route types:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "baseUrl": "/Users/kenanaiahjolmfc/Documents/Asbir-Handoff/apps/web",
    "paths": { "@/*": ["./*"] },
    "plugins": []
  },
  "include": [
    "/Users/kenanaiahjolmfc/Documents/Asbir-Handoff/apps/web/src/components/canvas/CanvasViewport.tsx",
    "/Users/kenanaiahjolmfc/Documents/Asbir-Handoff/apps/web/src/components/canvas/ElementInspector.tsx",
    "/Users/kenanaiahjolmfc/Documents/Asbir-Handoff/apps/web/src/components/canvas/element-distance-guides.ts"
  ],
  "exclude": [
    "/Users/kenanaiahjolmfc/Documents/Asbir-Handoff/apps/web/.next",
    "/Users/kenanaiahjolmfc/Documents/Asbir-Handoff/node_modules"
  ]
}
```

Run:

```bash
./node_modules/.bin/tsc --noEmit --pretty false -p /tmp/asbir-alt-distance-tsconfig.json
```

Expected: the scoped TypeScript check exits with code 0.

- [x] **Step 3: Check the final diff**

Run:

```bash
git diff --check
```

Expected: no whitespace errors; unrelated untracked files remain untouched.
