# Canvas overlapping layer selection

**Status:** Approved by user

**Date:** November 18, 2026

## Goal

Let reviewers select captured Figma layers that overlap or sit behind another layer in the review canvas.

## Interaction

- In Inspect mode, a plain click selects the topmost captured layer under the pointer.
- Option/Alt-click or Cmd-click selects the next captured layer behind the current hit. Repeating the modifier-click at the same point steps deeper through the overlapping layers.
- When the current selection is outside the hit stack, the first modifier-click skips the topmost layer and selects the next one. If there is only one hit, select it.
- Stop at the deepest hit; do not wrap to the top.
- Keep comment and annotation placement semantics unchanged.
- Keep Option/Alt-hover distance guides available when the pointer is over a different layer.

## Data flow and scope

- Use the existing captured layer bounds and canvas overlay hit targets to resolve layers under the pointer in rendered stacking order.
- Keep selection state, capture formats, persistence, APIs, and inspector behavior unchanged.
- Limit the behavior to the active canvas frame and Inspect mode.

## Verification

- Confirm a plain click selects the topmost overlapping layer.
- Confirm Option/Alt-click and Cmd-click step through the underlying layers and stop at the deepest hit.
- Confirm a single hit remains selectable with a modifier-click.
- Confirm comments, annotations, frame selection, and Option/Alt-hover distance guides retain their current behavior.
