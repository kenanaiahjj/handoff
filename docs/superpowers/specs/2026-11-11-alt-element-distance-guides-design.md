# Alt element distance guides

**Status:** Approved by user

**Date:** November 11, 2026

## Goal

Show pixel distances between two captured design elements directly on the canvas, using the familiar select, hold Alt, and hover interaction.

## Interaction

- In Inspect mode, keep one element selected and hold Alt while pointing at another captured element.
- Show in-canvas guide lines between the selected and hovered element bounds, with pixel labels for horizontal and vertical edge gaps.
- Measure in captured design pixels, independent of the canvas zoom level.
- Support both an individual frame view and the overview canvas. Keep the guide strokes and labels readable while zooming.
- Hide the guides when Alt is released, the pointer leaves a layer, the selected and hovered layers are the same, or either layer has incomplete bounds.
- Keep View mode and other pointer interactions unchanged.

## Measurement behavior

- Use the nearest horizontal and vertical edge gaps between the two element rectangles.
- Treat overlap or touching on an axis as zero; draw and label guides only for positive gaps.
- For a horizontal guide, place it within the vertical overlap when one exists, otherwise between the elements' vertical centers. Apply the equivalent rule to vertical guides.
- Render measurements as a non-interactive overlay in the canvas coordinate plane. Keep text and stroke thickness visually stable at different zoom levels.

## Scope

- Use existing captured layer bounds and the current selection/hover state.
- Do not change capture data, persistence, APIs, or frame selection behavior.
- Replace the current corner `Δ x · y` readout with the in-canvas guides and pixel labels.
- Keep the inspector hint aligned with the select, Alt, and hover interaction.

## Acceptance checks

- Selecting one element, holding Alt, and hovering a different element shows the correct edge gaps in pixels with guides aligned to the element bounds.
- Horizontal, vertical, and diagonal element arrangements show correctly placed guides.
- Overlap or touching on one axis shows no guide on that axis; any positive gap on the other axis remains visible.
- Incomplete bounds, releasing Alt, leaving a layer, or hovering the selected layer hides the measurements.
- Frame and overview views use the correct local coordinates and preserve measurements while panning and zooming.
- View mode, comments, notes, and element selection continue to work as before.
