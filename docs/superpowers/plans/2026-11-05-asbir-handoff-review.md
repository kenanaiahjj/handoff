# Asbir Handoff review and layout QA implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a team compare immutable handoff versions on a canvas, inspect exact design values, comment, export, and run configurable layout checks.

**Architecture:** Build review features on top of the snapshot contract and server repositories. Deterministic services compute frame/node changes and measurements; the UI presents those results with source provenance.

**Tech Stack:** Next.js App Router, TypeScript, React, CSS, browser Canvas API, Web Workers, Zod snapshot contract.

## Global Constraints

- Follow the approved snapshot contract and keep the complete design scope in the roadmap.
- Use source IDs to match nodes and frames. Do not let AI decide matches.
- Show exact source padding and token bindings only when source metadata provides them.
- Show a measured margin as a distance between selected bounds; do not label it as authored CSS margin.
- Keep comments attached to the version where they were created.
- Use `npm run lint` and `npm run build` for implementation checks. Do not add or run automated tests unless the user asks.

## File map

- `apps/web/src/components/canvas/` — canvas viewport, frames, pins, and comparison layers.
- `apps/web/src/components/inspector/` — geometry, layout, token, and color panels.
- `apps/web/src/server/services/measurements.ts` — exact and derived metric computation.
- `apps/web/src/server/services/diff.ts` — frame, node, property, and token diff.
- `apps/web/src/server/services/layout-rules.ts` — configured deterministic checks.
- `apps/web/src/server/repositories/comments.ts` — version-scoped comments.
- `apps/web/src/app/(workspace)/projects/[projectId]/handoffs/[handoffId]/` — review route.

## Task 1: Build the canvas and frame navigator

**Files:** Create `components/canvas/HandoffCanvas.tsx`, `CanvasViewport.tsx`, `FrameNavigator.tsx`, `CanvasToolbar.tsx`, and `useCanvasViewport.ts`.

**Interfaces:**

```ts
export interface CanvasTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function screenToFramePoint(
  point: { x: number; y: number },
  transform: CanvasTransform,
  frameOrigin: { x: number; y: number }
): { x: number; y: number };
```

- [ ] Load one authorized handoff version and render its overview and frame thumbnails from private asset routes.
- [ ] Render frames at their captured design dimensions. Keep CSS device pixel ratio separate from source coordinate units.
- [ ] Implement pointer-based pan, wheel zoom, zoom-to-fit, and frame selection in `useCanvasViewport.ts`.
- [ ] Add keyboard-focusable toolbar controls for zoom, fit, and comparison mode.
- [ ] Keep annotation pins in a positioned HTML overlay so they remain accessible and independently interactive.
- [ ] Run `npm run lint --workspace @asbir/web` and `npm run build --workspace @asbir/web`; manually check pan, zoom, fit, and frame selection at desktop and mobile widths.

## Task 2: Add the exact measurement inspector

**Files:** Create `components/inspector/ElementInspector.tsx`, `MeasurementRow.tsx`, `TokenBindingList.tsx`, and `src/server/services/measurements.ts`.

- [ ] Implement `getNodeMeasurements(node, parent, siblings)` returning bounds, explicit padding, explicit layout gaps, source margins, measured edge distances, colors, typography, and token bindings.
- [ ] Return a `Measurement` for every numeric field with `value`, `unit`, `provenance`, and `sourceProperty` as required by `@asbir/snapshot-contract`.
- [ ] For an element with no source margin property, calculate the distance from its bounds to a selected parent edge or sibling edge and label the row `Measured distance`.
- [ ] Display unbound fills and styles with their raw value and the label `No token binding`; never infer a token by value equality.
- [ ] Display `Unavailable` for missing source fields and suppress exactness badges for image-only snapshots.
- [ ] Add inspector rows for width, height, x/y, each padding edge, row/column gap, measured margins, fills, typography, and token mode.
- [ ] Run `npm run lint --workspace @asbir/web` and `npm run build --workspace @asbir/web`; manually inspect a fixture with explicit layout, one with manual positioning, and one visual-only upload.

## Task 3: Compute and display version diffs

**Files:** Create `src/server/services/diff.ts`, `pixel-diff.ts`, `src/workers/pixel-diff.worker.ts`, `components/diff/VersionCompare.tsx`, `DiffLegend.tsx`, and `DiffList.tsx`.

**Interfaces:**

```ts
export interface SnapshotDiff {
  fromVersionId: string;
  toVersionId: string;
  frames: Array<{ frameId: string; status: "added" | "removed" | "changed" | "unchanged" }>;
  changes: Array<{
    frameId: string;
    sourceNodeId: string | null;
    path: string;
    before: unknown;
    after: unknown;
    category: "geometry" | "layout" | "style" | "text" | "token" | "structure";
  }>;
}
```

- [ ] Match frames and nodes by source IDs and compare normalized properties field by field.
- [ ] Emit added and removed records when IDs exist in only one version. Treat an ID collision across sources as a separate node by including the source file ID.
- [ ] If source IDs changed, return unmatched candidates to the UI for explicit reviewer mapping; do not automatically merge candidate nodes.
- [ ] Compare bound token ID, collection, mode, and value separately from raw fills.
- [ ] Implement pixel diff in a Web Worker using decoded image bitmaps and `ImageData`; produce an overlay-ready difference bitmap at the canonical source dimensions.
- [ ] Add before/after, overlay, and pixel-diff modes with a structured change list linked to frame and node IDs.
- [x] Stress-test structured diffs across 210 screens and 31,500 nodes with five changed screens, and preserve 50,000 changes across five frames when layer IDs regenerate. Verified 2026-11-09.
- [x] Cull inspect hit targets to visible, actionable elements and use ID-based lookup for selected and hovered nodes. A 31,500-node fixture renders only the 150 targets in its viewport. Verified 2026-11-09.
- [x] Manually inspect a four-screen resize comparison in the running app: verify side-by-side, overlay opacity, pixel diff, and selection of another screen with its own recorded changes. Restored the browser to its original URL. Verified 2026-11-09.
- [ ] Run `npm run lint --workspace @asbir/web` and `npm run build --workspace @asbir/web`; manually compare two versions containing added, removed, moved, resized, and restyled elements.

## Task 4: Add comments, layout rules, and exports

**Files:** Create `src/server/repositories/comments.ts`, comments API routes, `components/comments/CommentThread.tsx`, `CommentPin.tsx`, `src/server/services/layout-rules.ts`, `components/inspector/LayoutFindings.tsx`, and `src/server/services/export.ts`.

- [ ] Add comment tables and API operations for create, list, resolve, and reply. Every comment stores workspace, version, frame ID, optional node ID, frame-relative point, author, and timestamp.
- [ ] Render comments from saved frame-relative points and convert them through the same canvas transform used by pins.
- [x] Test frame-relative pin placement in both overview and selected-screen coordinates, including reply and resolved-pin visibility. Verified 2026-11-09.
- [ ] Add a project rules JSON shape for allowed spacing values, required token binding categories, and optional frame bounds.
- [ ] Implement deterministic checks that return `ruleId`, `frameId`, `sourceNodeId`, actual value, expected values, and a human-readable explanation.
- [x] Keep rule findings distinct from AI-generated notes. Allow assignee, open/resolved status, comment, and export.
- [x] Export source frame images as PNG and JPEG at their stored dimensions. Offer the overview render and individual frame renders separately.
- [ ] Run `npm run lint --workspace @asbir/web` and `npm run build --workspace @asbir/web`; manually verify comments remain pinned after zooming and saved findings remain tied to the same version.

## Completion check

This plan is complete when reviewers can inspect full source measurements and provenance, compare both visual and structured changes, leave version-stable comments, run configured rules, and export selected frames and findings.
