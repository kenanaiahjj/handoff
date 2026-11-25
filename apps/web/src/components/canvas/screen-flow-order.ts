/**
 * Screens in the order they sit on the Figma page: row by row, top to bottom, then left to right
 * within a row. A screen joins a row when it overlaps the row's vertical span, so screens of
 * different heights laid out side by side still read as one row.
 */
export function screensInFlowOrder<T extends { sourceX: number; sourceY: number; sourceHeight: number }>(screens: readonly T[]): T[] {
  const rows: Array<{ top: number; bottom: number; items: T[] }> = [];
  for (const screen of [...screens].sort((a, b) => a.sourceY - b.sourceY || a.sourceX - b.sourceX)) {
    const row = rows.find((candidate) => screen.sourceY < candidate.bottom && screen.sourceY + screen.sourceHeight > candidate.top);
    if (row) {
      row.items.push(screen);
      row.bottom = Math.max(row.bottom, screen.sourceY + screen.sourceHeight);
    } else {
      rows.push({ top: screen.sourceY, bottom: screen.sourceY + screen.sourceHeight, items: [screen] });
    }
  }
  return rows.flatMap((row) => row.items.sort((a, b) => a.sourceX - b.sourceX));
}
