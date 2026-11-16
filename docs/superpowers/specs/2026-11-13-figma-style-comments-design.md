# Figma-style canvas comments

**Status:** Approved by user

**Date:** November 13, 2026

## Goal

Make canvas comments feel immediate and spatial, following Figma's comment interaction. Viewers must be able to place a comment on a frame or canvas, open a thread at its pin, reply, and resolve or reopen it. Other viewers with the same canvas open must see updates promptly.

## Interaction

- Press `C` to enter comment placement mode when the viewer can comment. Ignore the shortcut while the viewer is typing, editing content, or using a modified key combination.
- Click a frame or an empty canvas location to place a comment pin. Open a small anchored composer at that pin and focus its text field.
- Submitting a comment creates the thread and keeps its anchored thread open.
- Selecting an existing pin opens its thread beside the pin, showing the root comment, replies, reply composer, and resolve/reopen control.
- Selecting a thread from the comments list also opens the matching anchored thread. Keep the comments list available for browsing.
- Press `Escape` to leave placement mode or close the open thread. Clicking outside an open thread closes it.
- Keep all pinned comments in the canvas coordinate system already used by frame-relative and canvas-relative anchors.

## Permissions

- Any viewer who can comment can create and reply to comments and resolve or reopen threads, regardless of invited role.
- Enforce comment access on the existing version-scoped workspace and review endpoints. Link-based invite resolution can leave `resolved_by_user_id` empty when no signed-in user is available.
- Keep canvas-note authoring permissions independent from comment permissions.

## Live updates

- Continue using the version-scoped comments GET endpoint as the source of truth.
- Refresh comments every two seconds while the document is visible. Also refresh immediately when the tab becomes visible or regains focus.
- Prevent overlapping poll requests and stop polling when the component unmounts. Do not poll hidden tabs.
- Keep the last successful comment list when a refresh fails; resume on the next interval or visibility change.
- Apply successful local create, reply, and resolution responses immediately, then reconcile with the GET response.
- No database migration or push-service dependency is required.

## Scope

- Update `HandoffCanvas` for the `C` shortcut, comment polling, and thread selection state.
- Add an anchored thread/composer to `CanvasViewport`, using existing comment pins and canvas anchor conversion.
- Reuse existing comment API routes and repository. Adjust resolution authorization only as required to let comment-capable invitees resolve threads.
- Keep existing comment list, comment pins, link anchors, and annotations behavior intact.
- Do not change comment persistence shape or add a separate realtime service.

## Acceptance checks

- Pressing `C` enters comment placement mode for a viewer who can comment and does nothing while typing or when the viewer cannot comment.
- Clicking a frame or blank canvas point opens a focused composer at the correct pin location; submitting creates a visible pin and open thread.
- Selecting a pin or its thread-list entry opens the anchored thread with replies and reply, resolve, or reopen controls appropriate to the viewer's comment permission.
- A comment, reply, resolve, or reopen from one visible canvas appears in another visible canvas within the polling interval; returning to a hidden tab refreshes immediately.
- Poll requests never overlap, stop on unmount, and pause while hidden.
- Frame-relative and canvas-relative pin positions remain correct while zooming, panning, switching frames, and opening the overview.
- Existing comment list, annotations, layer inspection, and canvas navigation continue to work.
