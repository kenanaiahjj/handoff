"use client";

import type { CanvasFrameOption } from "./FrameNavigator";

type GridPattern = "COLUMNS" | "ROWS" | "GRID";
type CapturedLayoutGrid = Record<string, unknown> & {
  pattern: GridPattern;
  visible?: boolean;
};

const maxGridSections = 1_000;
const maxGridLines = 2_000;

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function layoutGridsForFrame(frame: CanvasFrameOption): CapturedLayoutGrid[] {
  const root = frame.nodes.find((node) => node.sourceNodeId === frame.id);
  const value = root?.sourcePayload.layoutGrids;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const grid = recordOf(entry);
    if (!grid || grid.visible === false || !["COLUMNS", "ROWS", "GRID"].includes(String(grid.pattern))) return [];
    return [grid as CapturedLayoutGrid];
  });
}

export function hasVisibleLayoutGrids(frames: CanvasFrameOption[]) {
  return frames.some((frame) => layoutGridsForFrame(frame).length > 0);
}

function gridColor(value: unknown) {
  const color = recordOf(value);
  const red = finiteNumber(color?.r);
  const green = finiteNumber(color?.g);
  const blue = finiteNumber(color?.b);
  const alpha = finiteNumber(color?.a);
  if (red === null || green === null || blue === null) return "rgba(184, 184, 184, 0.34)";
  const channels = [red, green, blue].map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255));
  const opacity = alpha === null ? 1 : Math.min(1, Math.max(0, alpha));
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${opacity})`;
}

function sectionLayout(grid: CapturedLayoutGrid, extent: number) {
  const alignment = typeof grid.alignment === "string" ? grid.alignment : "MIN";
  const gutter = Math.max(0, finiteNumber(grid.gutterSize) ?? 0);
  const offset = finiteNumber(grid.offset) ?? 0;
  const rawCount = grid.count;
  const autoCount = rawCount === "AUTO" || rawCount === null || rawCount === Infinity;
  const numericCount = finiteNumber(rawCount);
  let count = numericCount === null ? 0 : Math.floor(numericCount);
  let sectionSize = finiteNumber(grid.sectionSize);

  if (alignment === "STRETCH") {
    if (count < 1 || count > maxGridSections) return null;
    sectionSize = (extent - offset * 2 - gutter * (count - 1)) / count;
  } else {
    if (sectionSize === null || sectionSize <= 0) return null;
    if (autoCount) {
      const available = extent - (alignment === "CENTER" ? 0 : offset);
      count = Math.floor((available + gutter) / (sectionSize + gutter));
    }
  }

  if (sectionSize === null || !Number.isFinite(sectionSize) || sectionSize <= 0 || count < 1 || count > maxGridSections) return null;
  const totalSize = count * sectionSize + (count - 1) * gutter;
  const start = alignment === "CENTER"
    ? (extent - totalSize) / 2
    : alignment === "MAX"
      ? extent - offset - totalSize
      : offset;
  return { count, sectionSize, gutter, start };
}

function patternPath(grid: CapturedLayoutGrid, width: number, height: number) {
  const size = finiteNumber(grid.sectionSize);
  if (size === null || size <= 0) return null;
  const lineCount = Math.floor(width / size) + Math.floor(height / size) + 2;
  if (lineCount > maxGridLines) return null;
  const commands: string[] = [];
  for (let x = 0; x <= width; x += size) commands.push(`M${x} 0V${height}`);
  for (let y = 0; y <= height; y += size) commands.push(`M0 ${y}H${width}`);
  return commands.join("");
}

function renderGrid(grid: CapturedLayoutGrid, width: number, height: number, index: number) {
  const color = gridColor(grid.color);
  if (grid.pattern === "GRID") {
    const path = patternPath(grid, width, height);
    return path ? <path d={path} fill="none" key={`${grid.pattern}-${index}`} stroke={color} strokeWidth="1" /> : null;
  }

  const horizontal = grid.pattern === "COLUMNS";
  const sections = sectionLayout(grid, horizontal ? width : height);
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
  const grids = layoutGridsForFrame(frame);
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
