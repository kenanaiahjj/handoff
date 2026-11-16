import type { diffSnapshots } from "./diff";

type SnapshotDiff = ReturnType<typeof diffSnapshots>;

const reportedStatuses = new Set(["changed", "added", "removed"]);

/**
 * The screens that differ between two versions, with how many recorded changes each has
 * and which kinds (layout, style, text, visual…). Unchanged screens are only counted.
 */
export function summarizeChangedScreens(diff: SnapshotDiff) {
  const changesByFrame = new Map<string, { count: number; categories: Set<string> }>();
  for (const change of diff.changes) {
    const entry = changesByFrame.get(change.frameId) ?? { count: 0, categories: new Set<string>() };
    entry.count += 1;
    entry.categories.add(change.category);
    changesByFrame.set(change.frameId, entry);
  }

  const screens = diff.frames
    .filter((frame) => reportedStatuses.has(frame.status))
    .map((frame) => {
      const changes = changesByFrame.get(frame.frameId);
      return {
        frameId: frame.frameId,
        name: frame.name,
        status: frame.status as "changed" | "added" | "removed",
        changeCount: changes?.count ?? 0,
        categories: changes ? [...changes.categories].sort() : [],
      };
    });

  return {
    screens,
    counts: {
      changed: screens.filter((screen) => screen.status === "changed").length,
      added: screens.filter((screen) => screen.status === "added").length,
      removed: screens.filter((screen) => screen.status === "removed").length,
      unchanged: diff.frames.filter((frame) => frame.status === "unchanged").length,
      captureDifferences: diff.frames.filter((frame) => frame.status === "only-in-before-capture" || frame.status === "only-in-after-capture").length,
    },
  };
}
