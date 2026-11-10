import type { SnapshotDiff, SnapshotDiffChange, SnapshotSourceIdentity } from "../../server/services/diff";

export function captureScopeNotice(
  comparison: SnapshotDiff["captureScopeComparison"],
  hasCaptureOnlyFrames = false,
) {
  if (!comparison) {
    return hasCaptureOnlyFrames
      ? "Screens present in only one capture are not confirmed design additions or removals."
      : null;
  }
  if (comparison.status === "different") {
    return `Figma capture scopes differ. Before: ${comparison.before}. After: ${comparison.after}. Screens shown on only one side may be outside the other capture's scope.`;
  }
  return "Figma capture scope is missing for one or both versions. Treat screens shown on only one side as unconfirmed changes.";
}

export function comparisonFrameStatusLabel(
  status: SnapshotDiff["frames"][number]["status"],
) {
  if (status === "only-in-before-capture") return "No match in after";
  if (status === "only-in-after-capture") return "No match in before";
  if (status === "unchanged") return "No changes";
  if (status === "changed") return "Changed";
  if (status === "added") return "New";
  return "Removed";
}

export function captureCoverageAvailabilityLabel(availableIn: "before" | "after") {
  return availableIn === "before" ? "Before capture only" : "After capture only";
}

export type ComparisonChangeGroup = {
  id: string;
  label: string;
  sourceNodeId: string | null;
  changes: SnapshotDiffChange[];
};

export function sourceIdentityNotice(identity: SnapshotSourceIdentity) {
  if (identity === "inferred") {
    return "At least one snapshot has a legacy Figma file ID. The source file identity cannot be verified.";
  }
  if (identity === "different") {
    return "These versions have different Figma file IDs. Check screen matches before relying on this comparison.";
  }
  return null;
}

export function formatComparisonChangeCount(totalCount: number, visualCount: number) {
  const total = Math.max(0, Math.trunc(totalCount));
  const visual = Math.min(total, Math.max(0, Math.trunc(visualCount)));
  const captured = total - visual;
  const totalLabel = `${total} total ${total === 1 ? "change" : "changes"}`;
  const breakdown = [
    captured ? `${captured} captured` : "",
    visual ? `${visual} visual ${visual === 1 ? "difference" : "differences"}` : "",
  ].filter(Boolean);

  return breakdown.length ? `${totalLabel} (${breakdown.join(", ")})` : totalLabel;
}

export const comparisonCategories = ["geometry", "layout", "style", "text", "token", "structure", "visual"] as const;
type ComparisonCategory = typeof comparisonCategories[number];

export function countComparisonChangesByCategory(
  changes: Array<Pick<SnapshotDiffChange, "frameId" | "category">>,
  frameId: string,
): Record<ComparisonCategory, number> {
  const counts: Record<ComparisonCategory, number> = {
    geometry: 0,
    layout: 0,
    style: 0,
    text: 0,
    token: 0,
    structure: 0,
    visual: 0,
  };

  for (const change of changes) {
    if (change.frameId === frameId) counts[change.category] += 1;
  }

  return counts;
}

type ChangeSummary = Pick<SnapshotDiffChange, "path" | "category">;
type ChangeValueSource = Pick<SnapshotDiffChange, "path" | "category" | "before" | "after">;

function titleCase(value: string) {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

export function comparisonChangeLabel(change: ChangeSummary) {
  const { path } = change;
  if (path === "renderAsset") return "Screen render";
  if (path === "frame") return "Screen";
  if (path === "node") return "Layer";
  if (path.startsWith("tokens[")) return "Token binding";
  if (/^bounds\.(x|y|width|height)$/.test(path)) {
    return ({
      "bounds.x": "Horizontal position",
      "bounds.y": "Vertical position",
      "bounds.width": "Width",
      "bounds.height": "Height",
    } as const)[path as "bounds.x" | "bounds.y" | "bounds.width" | "bounds.height"];
  }

  const side = path.match(/^(padding|margins)\.(top|right|bottom|left)$/);
  if (side) return `${titleCase(side[2])} ${side[1] === "padding" ? "padding" : "margin"}`;
  if (/^(?:spacing|layout)\.(?:itemSpacing|counterAxisSpacing)$/.test(path)) return "Item spacing";
  if (/^fills\[\d+\]\.color$/.test(path) || /^sourcePayload\.fillPaintDetails\[\d+\]\.color(?:\.[rgba])?$/.test(path)) return "Fill color";
  if (/^strokes\[\d+\]\.color$/.test(path) || /^sourcePayload\.strokePaintDetails\[\d+\]\.color(?:\.[rgba])?$/.test(path)) return "Stroke color";
  if (/^fills\[\d+\]$/.test(path)) return "Fill";
  if (/^strokes\[\d+\]$/.test(path)) return "Stroke";
  if (/^fills\[\d+\]\.opacity(?:\.value)?$/.test(path)) return "Fill opacity";
  if (/^strokes\[\d+\]\.opacity(?:\.value)?$/.test(path)) return "Stroke opacity";
  if (/^styleReferences\[\d+\]\.name$/.test(path)) return "Applied style";
  if (/^sourcePayload\.textSegments\[\d+\]\.characters$/.test(path)) return "Text content";
  if (/^sourcePayload\.textSegments\[\d+\]\./.test(path)) return "Text style";
  if (path.startsWith("sourcePayload.")) return "Captured source data";

  const normalized = path.replace(/\[\d+\]/g, "").replace(/\[[^\]]+\]/g, "");
  const [root, ...rest] = normalized.split(".");
  if (root === "bounds") return titleCase(rest.join(" "));
  if (root === "typography") return titleCase(rest.join(" "));
  if (root === "layout" || root === "spacing") return titleCase(rest.join(" "));
  if (root === "fills") return `Fill ${titleCase(rest.join(" "))}`;
  if (root === "strokes") return `Stroke ${titleCase(rest.join(" "))}`;
  if (root === "styleReferences") return "Applied style";
  if (root === "name") return "Layer name";
  return titleCase(normalized.replace(/\./g, " ")) || "Captured property";
}

export function groupComparisonChanges(changes: SnapshotDiffChange[], screenName: string): ComparisonChangeGroup[] {
  const groups = new Map<string, ComparisonChangeGroup>();

  for (const change of changes) {
    const sourceNodeId = change.sourceNodeId;
    const id = sourceNodeId ? `node:${sourceNodeId}` : `screen:${change.frameId}`;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        label: change.sourceNodeName?.trim() || (sourceNodeId ? `Layer ${sourceNodeId}` : screenName),
        sourceNodeId,
        changes: [],
      };
      groups.set(id, group);
    }
    group.changes.push(change);
  }

  return [...groups.values()];
}

export function separateSupplementalChanges(changes: SnapshotDiffChange[]) {
  const visible: SnapshotDiffChange[] = [];
  const supplemental: SnapshotDiffChange[] = [];

  for (const change of changes) {
    if (/^sourcePayload\.(?:fillPaintDetails|strokePaintDetails)(?:\[|\.|$)/.test(change.path)) {
      supplemental.push(change);
    } else {
      visible.push(change);
    }
  }

  return { visible, supplemental };
}

export function comparisonValueLabel(
  change: ChangeValueSource,
  side: "before" | "after",
  formatValue: (value: unknown, category: string) => string,
) {
  const value = change[side];
  if (change.path === "renderAsset") return side === "before" ? "Previous render" : "Updated render";
  if (change.path === "frame") {
    if (value === undefined) return "Not present";
    return side === "before" ? (change.after === undefined ? "Removed" : "Present") : (change.before === undefined ? "Added" : "Present");
  }
  if (change.path === "node") {
    if (value === undefined) return "Not present";
    return side === "before" ? (change.after === undefined ? "Removed" : "Present") : (change.before === undefined ? "Added" : "Present");
  }
  return formatValue(value, change.category);
}

export function comparisonCategoryLabel(category: SnapshotDiffChange["category"]) {
  return ({
    geometry: "Geometry",
    layout: "Layout",
    style: "Style",
    text: "Text",
    token: "Token",
    structure: "Structure",
    visual: "Visual",
  } as const)[category];
}
