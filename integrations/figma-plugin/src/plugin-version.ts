// build.mjs stamps a 12-hex hash over a placeholder in the downloadable copy; dev builds keep the
// placeholder. Don't spell the placeholder here: the stamp would replace it too.
const buildIdPattern = /^[0-9a-f]{12}$/;

/** Where the plugin asks the server which build it currently hands out. */
export function pluginVersionUrl(handoffOrigin: string) {
  return new URL("/api/capture-sessions/plugin-version", handoffOrigin).toString();
}

/** Where "Get update" sends people: the Figma integration page, with the download button. */
export function pluginUpdatePageUrl(handoffOrigin: string) {
  return new URL("/integrations?open=figma", handoffOrigin).toString();
}

/**
 * True when the server hands out a different build than this one. Unstamped (dev) builds and
 * unreadable answers never prompt an update.
 */
export function isPluginOutdated(currentBuild: string, payload: unknown) {
  if (!buildIdPattern.test(currentBuild)) return false;
  const latest = payload && typeof payload === "object" ? (payload as { build?: unknown }).build : undefined;
  return typeof latest === "string" && buildIdPattern.test(latest) && latest !== currentBuild;
}
