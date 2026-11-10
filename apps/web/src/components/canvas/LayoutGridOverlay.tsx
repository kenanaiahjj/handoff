"use client";

import type { CanvasFrameOption } from "./FrameNavigator";
import {
  getVisibleLayoutGrids,
  layoutGridColor,
  layoutGridPath,
  layoutGridSections,
  type CapturedLayoutGrid,
} from "./layout-grid-overlay-model";

export { hasVisibleLayoutGrids } from "./layout-grid-overlay-model";

function renderGrid(grid: CapturedLayoutGrid, width: number, height: number, index: number) {
  const color = layoutGridColor(grid.color);
  if (grid.pattern === "GRID") {
    const path = layoutGridPath(grid, width, height);
    return path ? <path d={path} fill="none" key={`${grid.pattern}-${index}`} stroke={color} strokeWidth="1" /> : null;
  }

  const horizontal = grid.pattern === "COLUMNS";
  const sections = layoutGridSections(grid, horizontal ? width : height);
  if (!sections) return null;
  return Array.from({ length: sections.count }, (_, sectionIndex) => {
    const origin = sections.start + sectionIndex * (sections.sectionSize + sections.gutter);
    return (
      <rect
        fill={color}
        height={horizontal ? height : sections.sectionSize}
        key={`${grid.pattern}-${index}-${sectionIndex}`}
        width={horizontal ? sections.sectionSize : width}
        x={horizontal ? origin : 0}
        y={horizontal ? 0 : origin}
      />
    );
  });
}

export function LayoutGridOverlay({
  frame,
  left = 0,
  top = 0,
}: {
  frame: CanvasFrameOption;
  left?: number;
  top?: number;
}) {
  const grids = getVisibleLayoutGrids(frame);
  if (!grids.length || frame.sourceWidth <= 0 || frame.sourceHeight <= 0) return null;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute overflow-hidden"
      preserveAspectRatio="none"
      style={{ left, top, width: frame.sourceWidth, height: frame.sourceHeight }}
      viewBox={`0 0 ${frame.sourceWidth} ${frame.sourceHeight}`}
    >
      {grids.map((grid, index) => renderGrid(grid, frame.sourceWidth, frame.sourceHeight, index))}
    </svg>
  );
}
