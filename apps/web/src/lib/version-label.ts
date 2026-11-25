/** Server limit for a version label (capture sessions, package uploads and the database check). */
export const versionLabelMaxLength = 80;

/** Separator between a version number and its sub-version description, e.g. "2.0.5 · Schedules - edits". */
export const versionLabelSeparator = " · ";

/** The version number part of a label: "2.0.5 · Schedules - edits" → "2.0.5". */
export function versionLabelBase(label: string | null | undefined) {
  const trimmed = (label ?? "").trim();
  if (!trimmed) return "";
  return trimmed.split("·")[0].trim();
}

/** What "Start from latest" puts in the field: the latest base plus a separator, ready for a description. */
export function versionLabelStart(latestLabel: string | null | undefined) {
  const base = versionLabelBase(latestLabel);
  return base ? `${base}${versionLabelSeparator}` : "";
}

/**
 * The next version number after the latest: the last number in its base goes up by one, keeping any
 * zero padding. "2.0.5 · Schedules" → "2.0.6", "v1.9" → "v1.10", "Sprint 4" → "Sprint 5". Null without a number.
 */
export function nextVersionLabel(latestLabel: string | null | undefined) {
  const base = versionLabelBase(latestLabel);
  const match = /(\d+)(\D*)$/.exec(base);
  if (!match) return null;
  const [whole, digits, tail] = match;
  const bumped = String(Number(digits) + 1).padStart(digits.length, "0");
  return `${base.slice(0, base.length - whole.length)}${bumped}${tail}`;
}

/** True when the label already begins with the latest version's base, so there is nothing to suggest. */
export function startsFromLatest(label: string, latestLabel: string | null | undefined) {
  const base = versionLabelBase(latestLabel);
  return Boolean(base) && label.trim().startsWith(base);
}

/** The label sent to the server: trimmed, without a dangling separator left by "Start from latest". */
export function finalizeVersionLabel(label: string) {
  return label.trim().replace(/\s*·\s*$/, "").trim();
}

/** One line of a release note for the form, cut with an ellipsis. */
export function releaseNotePreview(note: string, maxLength = 90) {
  const line = note.trim().replace(/\s+/g, " ");
  return line.length > maxLength ? `${line.slice(0, maxLength - 1).trimEnd()}…` : line;
}
