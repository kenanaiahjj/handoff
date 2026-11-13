import type { SnapshotFrame } from "./types";

export type DuplicateFrameName = { name: string; count: number };

export function countBlankFrameNames(frames: readonly Pick<SnapshotFrame, "name">[]): number {
  return frames.filter((frame) => !frame.name.trim()).length;
}

export function findDuplicateFrameNames(frames: readonly Pick<SnapshotFrame, "name">[]): DuplicateFrameName[] {
  const counts = new Map<string, number>();
  for (const frame of frames) {
    const name = frame.name.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name: name || "(blank name)", count }));
}
