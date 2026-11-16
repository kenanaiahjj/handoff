# Canvas publish action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make publishing a handoff obvious from the canvas top bar and simplify the Version panel.

**Architecture:** Add a toolbar action that calls the existing publish endpoint for the selected latest version and refreshes the route after success. Keep publication status in the Version panel and keep privacy, invitation, and link controls in the existing Share dialog.

**Tech Stack:** Next.js App Router, React client components, TypeScript, Tailwind CSS, existing handoff publish API.

## Global Constraints

- Use the existing publish endpoint and current `canManageSharing` permission gate.
- Only the latest handoff version can be published.
- Do not add a database migration or change link privacy, invite, or version semantics.
- Keep publishing and sharing as separate actions: Publish creates or updates the review link; Share controls access and recipients.
- Keep source-compatible existing captured canvas data unchanged.

---

## File map

- `apps/web/src/components/canvas/CanvasToolbar.tsx`: owns the visible Publish action, request state, and accessible error feedback.
- `apps/web/src/components/canvas/HandoffCanvas.tsx`: supplies the toolbar with the publish endpoint, selected/latest version IDs, published version ID, and permission.
- `apps/web/src/components/canvas/CanvasPublicationStatus.tsx`: compact publication status for the Version panel; replaces the current publish card and embedded access form.
- `apps/web/app/workspace/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/page.tsx`: supplies the status component with the selected/latest/published version values.
- `apps/web/src/components/canvas/HandoffSharingControls.tsx`: corrects the unpublished message and avoids repeating access explanations before a link exists.
- `apps/web/app/globals.css`: defines the gold pill treatment for the top-bar Publish action using the dashboard's existing gold color and glow values.

### Task 1: Add a top-bar publish action

**Files:**
- Modify: `apps/web/src/components/canvas/HandoffCanvas.tsx`
- Modify: `apps/web/src/components/canvas/CanvasToolbar.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- `HandoffCanvas` passes `publishEndpoint: string | null`, `publishVersionId: string`, `latestVersionId: string`, `publishedVersionId: string | null`, and `canPublish: boolean` to `CanvasToolbar`.
- `CanvasToolbar` posts `{ versionId: publishVersionId }` to `publishEndpoint` and refreshes the current route after a successful response.

- [x] **Step 1: Derive publication state in `HandoffCanvas`.** Use `metadata.versions[0]?.id ?? metadata.selectedVersionId` as the latest version ID. Build the publish URL from the existing workspace, project, and handoff IDs only when `metadata.canManageSharing` is true. Pass the selected, latest, and published IDs to `CanvasToolbar`.

- [x] **Step 2: Add a toolbar request state.** In `CanvasToolbar`, add pending, success, and error state for publishing. Disable the action while pending. Use the selected version ID in the POST body, parse the existing `{ reviewUrl, reviewShareId, error }` response shape, call `router.refresh()` after success, and keep server or network errors in an `aria-live="polite"` message.

- [x] **Step 3: Render a clear label and guard.** Show `Publish` when no version has been published, `Publish update` when the latest version differs from the published version, and a non-interactive `Published` status when the latest version is already published. Disable publishing whenever the selected version is not the latest, whether or not an earlier version has been published, and explain `Select the latest version to publish.`

- [x] **Step 4: Style the action.** Add a `.canvas-publish-action` rule that uses `--warning` for the warm gold fill, `--primary-foreground` for text, a pill radius, and the same subtle gold glow and hover lift used by `.workspace-dashboard .capture-primary-action`. Keep Share visually secondary.

- [x] **Step 5a: Inspect the rendered toolbar.** The local app showed `Publish` beside Share with the gold pill style. The request-pending state was not triggered during UI inspection.

### Task 2: Simplify publication and access content

**Files:**
- Rename: `apps/web/src/components/canvas/PublishCanvasLink.tsx` to `apps/web/src/components/canvas/CanvasPublicationStatus.tsx`
- Modify: `apps/web/app/workspace/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/page.tsx`
- Modify: `apps/web/src/components/canvas/HandoffSharingControls.tsx`

**Interfaces:**
- `CanvasPublicationStatus` receives `versionId: string`, `publishedVersionId: string | null`, and `latestVersionId: string` and renders status only; it does not submit a publish request or embed `HandoffSharingControls`.
- `HandoffSharingControls` remains mounted by the existing top-bar Share dialog.

- [x] **Step 1: Replace the Version-panel publish form with a status row.** Show `Not published` if the handoff has no published version, `Published` if the selected version is the published version, and `Draft update` when the selected latest version has not been published. Include one short sentence directing authorized publishers to the top-bar Publish action. Do not render a second publish button or privacy controls in the Version panel.

- [x] **Step 2: Update the handoff page wiring.** Replace the `PublishCanvasLink` import and render with `CanvasPublicationStatus`. Pass the selected version ID, published version ID, and latest version ID. Keep the existing version history, release note, and capture controls unchanged.

- [x] **Step 3: Correct the pre-publication Share copy.** Replace `This handoff has no published canvas link yet. Open the canvas to publish a version.` with `Publish the latest version to create a review link.` Hide the repeated published-access heading and its “starts after you publish” sentence until a review URL exists.

- [x] **Step 4: Inspect Version and Share surfaces.** Confirm Version shows compact publication status with no embedded privacy/invitation section. Open Share and confirm privacy selection, invitation links, and copy-link controls remain available. Confirm no copy tells users to reopen the canvas.

### Task 3: Review publish states in the running app

**Files:**
- No additional files.

- [x] **Step 1: Open an unpublished latest version.** Confirm the top bar shows `Publish` and the Version panel says `Not published`.
- [ ] **Step 2: Publish the latest version.** This would mutate the handoff's publication and review-link state, so it was not executed during UI verification.
- [ ] **Step 3: Select a new latest draft.** Confirm the top bar shows `Publish update` for the latest version and disables publishing while an older version is selected.
- [ ] **Step 4: Inspect a failed request.** Use the app's existing API response/error handling; confirm any returned error appears in the toolbar live region and the action becomes usable again.
