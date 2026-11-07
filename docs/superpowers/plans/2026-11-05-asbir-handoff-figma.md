# Asbir Handoff Figma capture implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a product designer start a handoff from a Figma design and capture reproducible renders, node geometry, layout values, and bound tokens.

**Architecture:** A Figma plugin runs inside the source file, extracts the selected scope through the Plugin API, validates the shared snapshot contract, and uploads it to the hosted Handoff app using a short-lived capture token.

**Tech Stack:** Figma Plugin API, TypeScript, `@figma/plugin-typings`, shared Zod snapshot contract, `fetch`.

## Global Constraints

- Capture source frame and node IDs, hierarchy, bounds, layout properties, styles, bound variables, variable collections, modes, and renders.
- Preserve the source values and attach `sourceProperty` to measurements.
- Use the Figma Plugin API for local variable enumeration and node properties; do not depend on REST variable access plans for core capture.
- Never infer a variable binding from a matching color or number.
- A successful capture creates a new immutable Handoff version.
- Use `npm run lint` and `npm run build` for implementation checks. Do not add or run automated tests unless the user asks.

## File map

- `integrations/figma-plugin/package.json` — plugin build dependencies and commands.
- `integrations/figma-plugin/manifest.template.json` — plugin identity and entry points before environment-specific network access is rendered.
- `integrations/figma-plugin/manifest.json` — generated manifest with local or hosted Handoff origin.
- `integrations/figma-plugin/src/code.ts` — Figma document traversal and export.
- `integrations/figma-plugin/src/ui.html` and `src/ui.ts` — project selection, token entry, and capture status.
- `integrations/figma-plugin/src/capture.ts` — translation from Figma nodes to `SnapshotEnvelope`.
- `integrations/figma-plugin/build.mjs` — bundle plugin entry points.
- `apps/web/src/app/api/capture-sessions/route.ts` — issue one-time capture sessions.
- `apps/web/src/app/api/capture-sessions/[token]/snapshot/route.ts` — validate and ingest the capture.

## Task 1: Add short-lived capture sessions to Handoff

**Files:** Add capture session tables and route handlers to the web app.

**Interfaces:**

```ts
export interface CaptureSession {
  token: string;
  workspaceId: string;
  projectId: string;
  createdBy: string;
  expiresAt: string;
  usedAt: string | null;
}
```

- [x] Add a designer-only action that creates a cryptographically random, single-use capture token, stores only its hash, and displays the token once.
- [x] Expire capture sessions after 10 minutes and mark the session used in the same transaction that stores the snapshot.
- [x] Add `POST /api/capture-sessions` to issue a session and `POST /api/capture-sessions/snapshot` to accept one snapshot.
- [x] Validate workspace, project, token expiry, token unused state, payload schema, and asset sizes before creating a version.
- [x] Return the created project, handoff, and version IDs; reject replayed or expired tokens with 401.
- [x] Run web lint, type checking, and an isolated production build.

## Task 2: Build the Figma plugin shell

**Files:** Create the manifest, plugin package, UI, build script, and code entry point.

- [x] Create `integrations/figma-plugin/package.json` with scripts `build` and `lint`, and dependencies `@asbir/snapshot-contract` and `@figma/plugin-typings`.
- [x] Create `manifest.template.json` with `main: "dist/code.js"` and `ui: "dist/ui.html"`; make `build.mjs` write `manifest.json` with the configured `HANDOFF_PUBLIC_URL` in `networkAccess.allowedDomains`. Use `http://localhost:3000` only for local development and require HTTPS in production.
- [x] Build `src/ui.html` with fields for one-time Handoff capture token and capture scope, and a status region for errors and completion IDs.
- [x] Implement `src/code.ts` to show the UI, receive capture settings, and send captured payloads to `src/ui.ts` using Figma plugin messaging.
- [x] Add build output to `dist/` and ignore it in Git.
- [x] Run the plugin `npm run build` and `npm run lint` commands.

## Task 3: Capture exact Figma data

**Files:** Create `src/capture.ts` and update `src/code.ts`.

- [x] Read the current page and selected frames. If no frames are selected, show a clear instruction to select one or more frames and stop capture.
- [x] Traverse each selected frame recursively and record stable Figma node ID, parent ID, name, type, relative and absolute bounds, visibility, layout mode, per-edge padding, item spacing, wrap spacing, alignment, constraints, fills, strokes, text properties, and source payload.
- [x] Preserve Figma frame layout grids and their bound variables, then render captured rows, columns, and square grids as an optional overlay in the review canvas. Serialize Figma's infinite automatic count as `AUTO` so it remains distinguishable from missing data.
- [x] Enumerate local variables and collections with the Figma Plugin API, then resolve every node's bound variable IDs to variable name, type, collection, mode, and value.
- [x] Capture each frame using the Plugin API export method at source dimensions. Compose a page overview from captured frame positions and renders.
- [x] Populate every `Measurement` with `provenance: "source"` for explicit values and `sourceProperty` such as `paddingLeft` or `itemSpacing`.
- [x] For unbound fills, store their raw paint values and an empty token list.
- [x] Parse the completed envelope with `snapshotEnvelopeSchema`; block upload and name each missing required field when parsing fails.
- [x] Run web and plugin lint/build commands.
- [x] Load the plugin against a representative Figma file and compare displayed padding, spacing, token names/modes, frame dimensions, and renders with the source inspector. Verified 2026-11-07 against Tripket.ph Home: Figma and Handoff matched at 393 × 852; node `11598:32639` matched horizontal layout, 4 px vertical and 8 px horizontal padding, 8 px gap, and `primary/default` in Mode 1. The Figma render appeared in Handoff.

## Task 4: Upload and report the frozen handoff

**Files:** Update `src/ui.ts`, plugin UI, and capture API route.

- [x] Upload the validated snapshot with the one-time token, all frame images, and overview image.
- [x] Display the returned project, handoff, and version IDs with a link to the hosted handoff page.
- [x] Show upload failures without losing the local capture payload; allow the designer to retry with a valid capture token.
- [ ] Confirm a second capture creates a second version and leaves the first version's snapshot hash unchanged.
- [x] Run plugin and web lint/build commands.
- [ ] Capture two revisions of the same Figma file and verify exact measurements and structured diffs in Handoff.

## Completion check

This plan is complete when a designer can create two Figma handoff versions from the plugin and Handoff preserves the exact source frame, node, layout, and token data needed by the review inspector.
