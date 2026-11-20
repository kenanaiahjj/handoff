/**
 * What changed in the app, in the words a designer or reviewer would use. Newest first; one release per
 * deploy day. The update card shows the releases a window is missing, and "What's new" shows them all.
 *
 * Add to the top release (or start a new one) in the same commit as a change people will notice.
 * Leave out internal work (deploys, refactors, tests) unless it changes what people see or feel.
 */
export type ChangelogRelease = {
  /** The release date, YYYY-MM-DD. Also its id: later releases sort after earlier ones. */
  id: string;
  new?: string[];
  improved?: string[];
  fixed?: string[];
};

export const changelog: ChangelogRelease[] = [
  {
    id: "2026-11-20",
    new: [
      "Attach images to comments and replies: pick a file, paste one, or drag it in. Tap an image to see it full size.",
      "Local preview opens full screen. Connect your local or test build and compare it with any screen, side by side or as an overlay, and search to find a screen.",
      "Export the selected element or its whole screen from the Inspect panel, as PNG or JPEG at 1x to 4x, or as SVG when the capture has vectors.",
      "The canvas tools, overlays and zoom sit in a floating bar at the bottom of the canvas.",
      "This list of app updates, under What's new.",
    ],
    improved: [
      "Comment threads are easier to follow: replies sit under each comment, older replies fold away, and times read like \"5m\". Enter sends and Shift+Enter starts a new line.",
      "Screen names on the canvas span the full width of each screen. Sizes are in the Inspect panel.",
      "The version picker shows longer version names.",
      "Outlines, Grids, Compare and Local preview have text labels, and Changes has a clearer icon.",
      "Review changes glows when a version has changes, so it's hard to miss.",
      "Comparisons match regenerated and stacked layers, and ignore tiny measurement noise.",
    ],
    fixed: [
      "Comment popovers open on the side with more room instead of under the screens list.",
      "Edits are no longer reported a second time as margin changes.",
      "Image-only differences are checked pixel by pixel before they count as a change.",
    ],
  },
  {
    id: "2026-11-19",
    new: [
      "Project teams, and a Recently updated list on the dashboard.",
      "One-click Slack app setup on the Integrations page.",
      "The Figma plugin tells you when it's out of date.",
    ],
    improved: [
      "The canvas pans and zooms smoothly on large pages.",
      "Figma captures are faster and more reliable.",
      "Page addresses are shorter. Old links still work.",
    ],
    fixed: [
      "Sub-pixel drift between captures no longer shows up as design changes.",
      "Screens duplicated across Figma files are matched by name in comparisons.",
    ],
  },
  {
    id: "2026-11-18",
    new: ["Project access, activity, search, settings and push notifications."],
    fixed: ["The overview no longer shows through screens as a glow."],
  },
  {
    id: "2026-11-17",
    new: ["Member management and designer approval.", "Project logos."],
    improved: ["Large handoffs open faster.", "A tidier canvas top bar, and open tabs stay on the home screens."],
    fixed: ["The version picker no longer overlaps the toolbar on phones."],
  },
];

/** The newest release this bundle knows about. */
export const latestChangelogId = changelog[0]?.id ?? null;

/** Releases newer than `seenId` (all of them when nothing was seen). */
export function releasesSince(seenId: string | null) {
  return seenId ? changelog.filter((release) => release.id > seenId) : changelog;
}
