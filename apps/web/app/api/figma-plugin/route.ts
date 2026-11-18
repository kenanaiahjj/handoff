import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { getSupabaseStorageUrl } from "@/src/server/storage/supabase-object-store";
import { getSessionForRequest } from "@/src/server/workspace-access";

// Placeholders the template is built with (scripts/build-figma-plugin-template.mjs).
const handoffPlaceholder = "https://asbir-handoff-origin.invalid";
const storagePlaceholder = "https://asbir-storage-origin.invalid";
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function templateDirectory() {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "figma-plugin-template");
}

/** The address teammates' plugins talk to: the configured public URL, or the one this request used. */
function handoffOrigin(request: Request) {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  return new URL(configured || request.url).origin;
}

/**
 * Downloads the Figma capture plugin as a zip, already pointed at this server and its storage, so a
 * teammate unzips it and imports manifest.json in Figma. Signed-in people only.
 */
export async function GET(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to download the plugin." }, { status: 401 });

  let manifestSource: string;
  let code: string;
  let ui: string;
  try {
    [manifestSource, code, ui] = await Promise.all([
      readFile(path.join(templateDirectory(), "manifest.json"), "utf8"),
      readFile(path.join(templateDirectory(), "dist/code.js"), "utf8"),
      readFile(path.join(templateDirectory(), "dist/ui.html"), "utf8"),
    ]);
  } catch {
    return Response.json({ error: "The plugin isn't built on this server yet. Run npm run plugin:template in apps/web." }, { status: 503 });
  }

  const origin = handoffOrigin(request);
  const storageOrigin = getSupabaseStorageUrl();
  const fill = (text: string) => text.replaceAll(handoffPlaceholder, origin).replaceAll(storagePlaceholder, storageOrigin);

  const manifest = JSON.parse(manifestSource) as { name: string; networkAccess: { allowedDomains: string[]; devAllowedDomains: string[]; reasoning: string } };
  const local = loopbackHosts.has(new URL(origin).hostname);
  // A copy that talks to a local server is labelled so it sits apart from the production plugin.
  if (local) manifest.name = `${manifest.name} (Local)`;
  manifest.networkAccess = {
    allowedDomains: [`${origin}/api/capture-sessions/`, storageOrigin],
    reasoning: manifest.networkAccess.reasoning,
    devAllowedDomains: local ? [...new Set([origin, storageOrigin])] : [],
  };

  const folder = "Asbir Handoff Figma plugin";
  const zip = zipSync({
    [`${folder}/manifest.json`]: strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    [`${folder}/dist/code.js`]: strToU8(fill(code)),
    [`${folder}/dist/ui.html`]: strToU8(fill(ui)),
    [`${folder}/README.txt`]: strToU8(
      [
        "Asbir Handoff Capture: Figma plugin",
        "",
        `This copy sends captures to ${origin}.`,
        "",
        "Install (Figma desktop app):",
        "1. Unzip this folder somewhere you'll keep it (moving it later breaks the plugin).",
        "2. In Figma: Plugins > Development > Import plugin from manifest...",
        "3. Choose manifest.json in this folder.",
        "4. Run it from Plugins > Development > Asbir Handoff Capture.",
        "",
        "To update, download it again from Integrations in Asbir Handoff and import the new manifest.json.",
        "",
      ].join("\n"),
    ),
  }, { level: 6 });

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="asbir-handoff-figma-plugin.zip"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
