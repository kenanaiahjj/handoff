import { captureSectionRecords } from "@asbir/snapshot-contract";

/** A captured Figma section, placed in the overview's own coordinates (like keepRects). */
export type CanvasSection = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** CSS colour of the section's fill, or null to draw it as a plain outline. */
  fill: string | null;
  /** The version's screens in this section. */
  frameIds: string[];
};

/**
 * Sections to draw under a version's screens. Only sections that still hold one of the version's
 * screens are drawn, at their Figma position plus their page's offset on the canvas.
 */
export function canvasSectionsFromMetadata(input: {
  sourceMetadata: Record<string, unknown>;
  frameIds: ReadonlySet<string>;
  pageOffsets: ReadonlyMap<string, { offsetX: number; offsetY: number }>;
  origin: { x: number; y: number };
}): CanvasSection[] {
  return captureSectionRecords(input.sourceMetadata).flatMap((section) => {
    if (section.width <= 0 || section.height <= 0) return [];
    if (!section.frameIds.some((id) => input.frameIds.has(id))) return [];
    const offset = section.sourcePageId ? input.pageOffsets.get(section.sourcePageId) : undefined;
    return [{
      id: section.sourceSectionId,
      name: section.name,
      x: section.x + (offset?.offsetX ?? 0) - input.origin.x,
      y: section.y + (offset?.offsetY ?? 0) - input.origin.y,
      width: section.width,
      height: section.height,
      fill: section.fill,
      frameIds: section.frameIds.filter((id) => input.frameIds.has(id)),
    }];
  });
}
