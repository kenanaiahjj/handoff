/**
 * Figma sections captured with their screens, kept in `sourceMetadata.sections`.
 *
 * A section capture replaces that section on the handoff canvas: screens the previous version
 * had in the section but the new capture doesn't are removed, while screens captured outside it
 * stay. Coordinates are Figma page coordinates, like frame bounds (add the page's layout offset
 * to place them on the canvas).
 */
export type CaptureSectionRecord = {
  sourceSectionId: string;
  sourcePageId: string | null;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The section's first visible solid fill as #RRGGBB or #RRGGBBAA, or null when it has none. */
  fill: string | null;
  /** Top-level screens captured in the section (screens in nested sections count as this one's). */
  frameIds: string[];
  /** Screens in the section left out of this capture on purpose: kept as they were, not removed. */
  skippedFrameIds?: string[];
};

function stringList(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : [];
}

export function captureSectionRecords(sourceMetadata: Record<string, unknown> | null | undefined): CaptureSectionRecord[] {
  const value = sourceMetadata?.sections;
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.sourceSectionId !== "string" || seen.has(record.sourceSectionId)) return [];
    const numbers = [record.x, record.y, record.width, record.height];
    if (numbers.some((number) => typeof number !== "number" || !Number.isFinite(number))) return [];
    seen.add(record.sourceSectionId);
    const skippedFrameIds = stringList(record.skippedFrameIds);
    return [{
      sourceSectionId: record.sourceSectionId,
      sourcePageId: typeof record.sourcePageId === "string" ? record.sourcePageId : null,
      name: typeof record.name === "string" && record.name.trim() ? record.name : "Untitled section",
      x: record.x as number,
      y: record.y as number,
      width: Math.max(0, record.width as number),
      height: Math.max(0, record.height as number),
      fill: typeof record.fill === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(record.fill) ? record.fill : null,
      frameIds: stringList(record.frameIds),
      ...(skippedFrameIds.length ? { skippedFrameIds } : {}),
    }];
  });
}

/**
 * Baseline screens a capture removes because they were in a section it re-captured and aren't
 * in it any more. Screens already replaced (same ID, a confirmed match, or a unique name) and
 * screens deliberately left out of the capture are not removed.
 */
export function sectionReplacedFrameIds(input: {
  baselineSections: readonly CaptureSectionRecord[];
  incomingSections: readonly CaptureSectionRecord[];
  baselineFrameIds: ReadonlySet<string>;
  incomingFrameIds: ReadonlySet<string>;
  replacedFrameIds: ReadonlySet<string>;
}) {
  const incomingById = new Map(input.incomingSections.map((section) => [section.sourceSectionId, section] as const));
  const removed = new Set<string>();
  for (const section of input.baselineSections) {
    const incoming = incomingById.get(section.sourceSectionId);
    if (!incoming) continue;
    const skipped = new Set(incoming.skippedFrameIds ?? []);
    for (const frameId of section.frameIds) {
      if (!input.baselineFrameIds.has(frameId) || input.incomingFrameIds.has(frameId)) continue;
      if (input.replacedFrameIds.has(frameId) || skipped.has(frameId)) continue;
      removed.add(frameId);
    }
  }
  return removed;
}

/**
 * The sections of a merged version: each re-captured section replaces its earlier record, other
 * sections stay (minus screens that moved into a re-captured section or left the version), and
 * sections with no screens left are dropped.
 */
export function mergeCaptureSections(input: {
  baselineSections: readonly CaptureSectionRecord[];
  incomingSections: readonly CaptureSectionRecord[];
  /** Screen IDs in the merged version. */
  frameIds: ReadonlySet<string>;
  /** Baseline screen ID → the incoming screen that replaced it under another ID. */
  replacementIds?: ReadonlyMap<string, string>;
  /** Pages whose earlier sections are dropped because the capture replaced the whole page. */
  replacedPageIds?: ReadonlySet<string>;
}): CaptureSectionRecord[] {
  const incomingById = new Map(input.incomingSections.map((section) => [section.sourceSectionId, section] as const));
  const baselineById = new Map(input.baselineSections.map((section) => [section.sourceSectionId, section] as const));
  const claimed = new Set(input.incomingSections.flatMap((section) => section.frameIds));
  const membersOf = (ids: readonly string[]) => [...new Set(ids.map((id) => input.replacementIds?.get(id) ?? id))]
    .filter((id) => input.frameIds.has(id));
  const incomingRecord = (section: CaptureSectionRecord): CaptureSectionRecord => {
    // Screens left out of the capture stay where they were, so they still belong to the section.
    const { skippedFrameIds, ...record } = section;
    return { ...record, frameIds: membersOf([...section.frameIds, ...(skippedFrameIds ?? [])]) };
  };
  const merged: CaptureSectionRecord[] = [];
  for (const section of input.baselineSections) {
    const incoming = incomingById.get(section.sourceSectionId);
    if (incoming) {
      merged.push(incomingRecord(incoming));
      continue;
    }
    if (section.sourcePageId && input.replacedPageIds?.has(section.sourcePageId)) continue;
    merged.push({ ...section, frameIds: membersOf(section.frameIds).filter((id) => !claimed.has(id)) });
  }
  for (const section of input.incomingSections) {
    if (!baselineById.has(section.sourceSectionId)) merged.push(incomingRecord(section));
  }
  return merged.filter((section) => section.frameIds.length > 0);
}
