# Compare image metadata layout

## Goal

Make the Before and After image headers easier to scan while preserving the exact design and raster dimensions for each capture.

## Design

Keep the `Before` or `After` label and the primary design dimensions in a compact header row. Give the design dimensions the readable data style from the existing design system. Place raster dimensions on a second, quieter line and show them only when they differ from the design dimensions. Use the existing dark palette and spacing tokens; do not add cards, badges, or decorative borders.

On narrow panes, allow the header content to wrap without clipping or overlapping the image controls. Keep all dimension values exact.

## Acceptance criteria

- The Before and After labels remain clear and aligned with their image panes.
- The design dimensions are easier to read than the secondary raster dimensions.
- Raster dimensions remain visible when they differ from the design dimensions.
- Neither metadata line clips, overlaps, or obscures comparison controls at narrow widths.
- The change stays within `VersionCompare.tsx` and does not alter captured image pixels or comparison behavior.

## Verification

Review the comparison view at desktop and narrow widths. Confirm that both dimension lines are readable and that the existing Highlights control remains unobstructed.
