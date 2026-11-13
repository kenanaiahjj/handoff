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

- [x] Load one authorized handoff version and render its overview and frame thumbnails from private asset routes. Verified 2026-11-12 in the local review app with a 13-screen Figma snapshot.
- [x] Render frames at their captured design dimensions. Keep CSS device pixel ratio separate from source coordinate units. Verified 2026-11-12 with a 392 × 999 px screen in the inspector; canvas elements use design dimensions for CSS size and stored raster dimensions for intrinsic image size.
- [x] Implement pointer-based pan, wheel zoom, zoom-to-fit, and frame selection in `useCanvasViewport.ts`. Verified 2026-11-12: dragging moved the board, wheel zoom changed 8% to 28%, Fit returned to 8%, and selecting a screen updated the active screen and dimensions.
- [x] Add keyboard-focusable toolbar controls for zoom, fit, and comparison mode. Verified 2026-11-12: Tab focused the Zoom out control; Fit and Review changes are exposed as buttons with visible focus styles.
- [x] Keep comment and canvas-note pins in a positioned HTML overlay so they remain accessible and independently interactive. Comment pins counter-scale with the canvas to preserve their 28 px target size. Verified 2026-11-12 on a saved comment at 20%, 17%, and 8% zoom; the pin stayed on its screen and opened the comment panel when selected. Canvas-note rendering uses the same counter-scale treatment; no saved note was available for live interaction verification.
- [x] Run `npm run lint --workspace @asbir/web` and `npm run lint --workspace @asbir/figma-plugin`. Verified 2026-11-12.
- [x] Run `npm run build --workspace @asbir/web`. Verified 2026-11-12 with `ASBIR_NEXT_DIST_DIR` pointing to `.next-codex-build.se1kh4`, isolated from the active dev server's `.next` output.
- [x] Manually check pan, zoom, fit, and frame selection at desktop width. Verified 2026-11-12 in the local review app.
- [x] Manually check pan, zoom, fit, and frame selection at mobile widths. Verified 2026-11-12 at a 390 × 844 emulated viewport: screen selection opened details; the toolbar scrolled to expose Fit, zoom, and export; Fit, zoom, and canvas drag worked; selecting a layer opened the full-width inspector without document scrolling. Physical-device behavior remains unverified.

## Task 2: Add the exact measurement inspector

**Files:** `integrations/figma-plugin/src/capture.ts`, `packages/snapshot-contract/src/schema.ts`, `apps/web/src/components/canvas/ElementInspector.tsx`, `MeasurementRow.tsx`, `text-style-runs.ts`, and `format-captured-measurement.ts`.

- [x] Capture Figma-native bounds, auto-layout padding and spacing, measured margins, paint data, typography, and bound variables in the Figma adapter. Keep source measurements separate from values derived from bounds. Verified 2026-11-13 by the Figma capture tests and source review.
- [x] Preserve each numeric measurement with its value, unit, provenance, and source property in the shared snapshot contract. Keep fractional Figma pixel values unchanged in the inspector and comparison display. Verified 2026-11-13 with the full test suite and focused measurement-format tests.
- [x] Calculate measured edge distances from the immediate parent’s captured bounds and label them `Measured distance`. Verified 2026-11-13 in the Figma adapter and inspector source.
- [x] Display raw unbound paint and style values, and explain that matching raw values do not imply a token binding. Never infer a token by value equality. Verified 2026-11-13 in the inspector source.
- [x] Display `Unavailable` for missing source fields and suppress exactness badges for image-only snapshots. Verified 2026-11-11 with inspector and Figma grid regression coverage.
- [x] Show width, height, x/y, each padding edge, row/column gap, measured margins, fills, typography, and token mode in the inspector. Verified 2026-11-13 in the inspector source and full repository test suite.
- [x] Run `npm test`, `npm run lint`, the isolated web production build, and the Figma plugin build and type-check. Verified 2026-11-13.
- [ ] Manually inspect a structured Figma fixture with auto layout, one with manual positioning, and one visual-only upload in the app. The user plans to review the UI.

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

- [x] Match frames and nodes by source IDs only when both snapshots identify the same source file, then compare normalized properties field by field. Verified 2026-11-11 with same-file, copied-file, and legacy-source diff cases.
- [x] Emit added and removed records when IDs exist in only one version. Keep a reused node ID from a different source file separate from both records. Verified 2026-11-11 with the cross-file node-ID collision regression case.
- [x] If source IDs changed, return unmatched candidates to the UI for explicit reviewer mapping; do not automatically merge candidate nodes. Verified 2026-11-11 with renamed, duplicate, and reviewer-confirmed layer cases.
- [x] Keep regenerated node IDs unmatched when type/name candidates are ambiguous or renamed; only auto-match unique type/name pairs. Added duplicate-label and rename regression cases; verified 2026-11-11.
- [x] Show unmatched node candidates in the compare UI and persist reviewer-confirmed node matches for the selected version pair. Let reviewers search all unmatched same-type layers by name or source ID when the first ten suggestions do not include the intended match. Reuse confirmed mappings in canvas comparisons, published review, MCP diffs, and AI changelog evidence; do not reuse them for other version pairs. Verified by the 250-test suite, lint, and production build on 2026-11-11.
- [x] Compare bound token ID, collection, mode, and value separately from raw fills. Compare source IDs only when both versions identify the same source file; keep semantic comparisons across copied files resilient to ID churn. Show field-level token labels in compare. Verified 2026-11-11.
- [x] Implement pixel diff in a Web Worker using decoded image bitmaps and `ImageData`; produce an overlay-ready difference bitmap at the canonical source dimensions. Keep both image layers anchored to the same top-left source origin when screen dimensions differ. Verified 2026-11-11 with a 420 × 2073 before screen and a 393 × 2073 after screen.
- [x] Add before/after, overlay, and pixel-diff modes with a structured change list linked to frame and node IDs. Verified in the running app with the four-screen resize fixture on 2026-11-11.
- [x] Stress-test structured diffs across 210 screens and 31,500 nodes with five changed screens, and preserve 50,000 changes across five frames when layer IDs regenerate. Verified 2026-11-09. On 2026-11-12, also verified unique screen-name pairing after frame and layer IDs regenerate: five screens produced six geometry, style, token, text, layout, and visual changes while 205 screens stayed unchanged.
- [x] Cull inspect hit targets to visible, actionable elements and use ID-based lookup for selected and hovered nodes. A 31,500-node fixture renders only the 150 targets in its viewport. Verified 2026-11-09.
- [x] Manually inspect a four-screen resize comparison in the running app: verify side-by-side, overlay opacity, pixel diff, and selection of another screen with its own recorded changes. Restored the browser to its original URL. Verified 2026-11-09.
- [x] Run `npm run lint --workspace @asbir/web` and `npm run build --workspace @asbir/web`. Verified 2026-11-11.
- [x] Manually compare two versions containing added, removed, moved, resized, and restyled elements. Verified 2026-11-12 in the running app with `Before — original` and `After — controlled changes`: 4 changed screens and 57 total changes, including a removed/added layer, width and X changes, padding/margin changes, and fill-color changes. Side-by-side, overlay, pixel diff, and close-to-canvas behavior all worked. The fixture uses a legacy Figma file ID, so the UI correctly warns that source-file identity cannot be verified.

## Task 4: Add comments, layout rules, and exports

**Files:** Create `src/server/repositories/comments.ts`, comments API routes, `components/comments/CommentThread.tsx`, `CommentPin.tsx`, `src/server/services/layout-rules.ts`, `components/inspector/LayoutFindings.tsx`, and `src/server/services/export.ts`.

- [x] Add comment persistence and API operations for create, list, resolve, and reply. Every comment stores workspace, version, frame ID, optional node ID, frame-relative point, author, and timestamp. Verified 2026-11-13 in the repository, workspace comment routes, and published-review routes.
- [x] Render comments from saved frame-relative points and convert them through the canvas anchor transform used by pins. Verified 2026-11-12 in the local review app and 2026-11-13 in the current source.
- [x] Test frame-relative pin placement in both overview and selected-screen coordinates, including reply and resolved-pin visibility. Verified 2026-11-09.
- [x] Add a project rules JSON shape for allowed spacing values, required token binding categories, and optional frame bounds.
- [x] Implement deterministic checks that return `ruleId`, `frameId`, `sourceNodeId`, actual value, expected values, and a human-readable explanation.
  - Verified 2026-11-11: exact spacing, measured-margin provenance, missing color/spacing token bindings, and 31,500 elements across 210 screens; the fixture produced 63,000 unique findings in about 102 ms.
- [x] Keep rule findings distinct from AI-generated notes. Allow assignee, open/resolved status, comment, and export.
- [x] Scope saved finding state and comments to immutable version IDs in repository queries and API routes. Verified 2026-11-13 in source; no app-level two-version review has been performed.
- [x] Export source frame images as PNG and JPEG at their stored dimensions. Offer the overview render and individual frame renders separately.
- [x] Run the full test suite, web lint and isolated production build. Verify comment pins remain on their screens after zooming. Verified 2026-11-12 and 2026-11-13.
- [ ] In the app, resolve or annotate a finding on one version, then confirm the same finding stays unchanged on a second version.

## Completion check

This plan is complete when reviewers can inspect full source measurements and provenance, compare both visual and structured changes, leave version-stable comments, run configured rules, and export selected frames and findings.
