export type DuplicateFrameName = { name: string; count: number };

export function findDuplicateFrameNames(frames: readonly { name: string }[]): DuplicateFrameName[] {
  const counts = new Map<string, number>();
  for (const frame of frames) counts.set(frame.name, (counts.get(frame.name) ?? 0) + 1);

  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }));
}
