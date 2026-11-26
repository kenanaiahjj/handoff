type NamedScreen = { id: string; name: string; fileName: string };

function safeName(name: string) {
  // "Onboarding - Sign In" reads as Onboarding-Sign-In, not Onboarding---Sign-In.
  return name.replace(/[^a-z0-9_-]+/gi, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "") || "screen";
}

/**
 * File names for a zip of screens, numbered in the order given (page order) so they sort the same way
 * in Finder. Each keeps the extension of its captured image (PNG or SVG).
 */
export function screenExportFileNames(screens: NamedScreen[]): string[] {
  const width = String(screens.length).length < 2 ? 2 : String(screens.length).length;
  return screens.map((screen, index) => {
    const extension = /\.([a-z0-9]+)$/i.exec(screen.fileName)?.[1]?.toLowerCase() ?? "png";
    return `${String(index + 1).padStart(width, "0")}-${safeName(screen.name)}.${extension}`;
  });
}

/** One line per screen, "Name: link", for pasting into a ticket or chat. The link opens zoomed to that screen. */
export function screenLinkLines(screens: Array<{ id: string; name: string }>, pageUrl: string): string {
  return screens
    .map((screen) => {
      const url = new URL(pageUrl);
      url.hash = new URLSearchParams({ screen: screen.id }).toString();
      return `${screen.name}: ${url.toString()}`;
    })
    .join("\n");
}
