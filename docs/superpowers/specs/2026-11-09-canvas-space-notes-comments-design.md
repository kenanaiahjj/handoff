# Canvas-space notes and comments

**Status:** Approved by user

**Date:** November 9, 2026

## Goal

Let users place canvas notes and comment pins on any visible point in the captured canvas, including points inside frames and blank space between frames.

## Placement behavior

- A point inside a screen frame is stored relative to that frame. Existing frame-anchored notes and comments keep their current behavior.
- A point outside every visible screen frame is stored relative to the canvas overview with the existing `__overview__` frame ID sentinel.
- Canvas-space pins remain attached to canvas coordinates when users pan or zoom. They are scoped to the selected immutable version like current notes and comments.
- If a user clicks a layer while placing a comment or note, link the pin to that layer. A previously selected layer is not linked when the user clicks elsewhere.
- Canvas-space pins render on the overview at their stored position. When a frame view is active, render them only when their canvas coordinates fall inside that view.

## Data and validation

- Reuse the existing `frame_id`, `x`, and `y` fields. No database migration is required.
- Comments already accept `__overview__` anchors on authenticated and review routes. Keep those validation rules intact.
- Extend both annotation creation routes to accept `__overview__`, validate coordinates against the captured overview/canvas bounds, and reject layer IDs for canvas-space points.
- Keep existing authorization, version scoping, thread replies, and frame-point validation unchanged.

## Interface behavior

- Keep the current comment and note creation controls.
- Update placement instructions to say users can click a frame or blank canvas space.
- Label overview-anchored items as “Canvas” in pending forms and comment/note lists.

## Acceptance checks

- Clicking inside a frame creates a frame-relative comment or note at the clicked point.
- Clicking blank space in the overview creates a canvas-relative comment or note at the clicked point.
- Canvas-space pins remain aligned when the canvas is panned or zoomed and do not shift to a frame.
- Frame-space and canvas-space pins render in the overview; frame views show canvas-space pins only when their coordinates fall inside the frame view.
- Comments and notes retain their current authorization, version scope, thread behavior, editing, and resolution behavior.
- Placement does not attach a previously selected layer unless the user clicks that layer.
- Both authenticated workspace routes and invited review routes accept valid canvas-space points and reject out-of-bounds points.
