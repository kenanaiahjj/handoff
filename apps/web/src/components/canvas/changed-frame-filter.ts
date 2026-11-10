type FrameChangeStatus = "added" | "removed" | "changed" | "unchanged" | "only-in-before-capture" | "only-in-after-capture";

export function filterChangedFrames<T extends { id: string }>(
  frames: readonly T[],
  changedOnly: boolean,
  frameStatuses: Readonly<Record<string, FrameChangeStatus | undefined>>,
  comparisonAvailable: boolean,
): T[] {
  if (!changedOnly || !comparisonAvailable) return [...frames];
  return frames.filter((frame) => {
    const status = frameStatuses[frame.id];
    return status === "changed" || status === "added" || status === "only-in-after-capture";
  });
}
