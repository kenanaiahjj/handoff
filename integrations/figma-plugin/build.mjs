import { createHash } from "node:crypto";
import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPluginNetworkAccess, deriveStorageOrigin } from "./src/network-access.mjs";

const buildPlaceholder = "asbir-plugin-build-placeholder";

const here = path.dirname(fileURLToPath(import.meta.url));
// PLUGIN_OUT_DIR builds a separate copy (the web app's downloadable template) without touching
// the local dist/ folder or manifest.json that Figma is loading during development.
const separateOutput = process.env.PLUGIN_OUT_DIR?.trim();
const outputDirectory = separateOutput ? path.resolve(separateOutput, "dist") : path.join(here, "dist");
const manifestPath = separateOutput ? path.resolve(separateOutput, "manifest.json") : path.join(here, "manifest.json");
const publicUrl = process.env.HANDOFF_PUBLIC_URL?.trim() || "http://localhost:3000";
const supabaseUrl = process.env.SUPABASE_URL?.trim() || "http://127.0.0.1:54321";
const storageUrl = process.env.SUPABASE_STORAGE_URL?.trim() || supabaseUrl;
const endpoint = new URL(publicUrl);
const storageOrigin = deriveStorageOrigin(storageUrl);
const networkAccess = buildPluginNetworkAccess(publicUrl, supabaseUrl, storageUrl);

await mkdir(outputDirectory, { recursive: true });
const [, uiBuild] = await Promise.all([
  build({ entryPoints: [path.join(here, "src/code.ts")], outfile: path.join(outputDirectory, "code.js"), bundle: true, platform: "browser", format: "iife", target: ["es2022"], minify: true, legalComments: "none", define: { __ASBIR_HANDOFF_ORIGIN__: JSON.stringify(endpoint.origin) } }),
  build({ entryPoints: [path.join(here, "src/ui.ts")], outfile: path.join(outputDirectory, "ui.js"), bundle: true, platform: "browser", format: "iife", target: ["es2022"], minify: true, legalComments: "none", define: { __ASBIR_HANDOFF_ORIGIN__: JSON.stringify(endpoint.origin), __ASBIR_STORAGE_ORIGIN__: JSON.stringify(storageOrigin), __ASBIR_PLUGIN_BUILD__: JSON.stringify(buildPlaceholder) }, write: false }),
]);

const uiSource = await readFile(path.join(here, "src/ui.html"), "utf8");
const uiScript = uiBuild.outputFiles.find((file) => file.path.endsWith("ui.js"))?.text;
const scriptTag = /<script\s+src=(['"])\.\/ui\.js\1\s*><\/script>/;
if (!uiScript || !scriptTag.test(uiSource)) throw new Error("The Figma UI bundle could not be embedded in ui.html.");
const safeUiScript = uiScript.replace(/<\/script/gi, "<\\/script");
const unstampedUi = uiSource.replace(scriptTag, () => `<script>\n${safeUiScript}\n</script>`);
// The downloadable copy is stamped with a hash of what was built, so it can tell when the server
// hands out a newer one. The local dev copy keeps the placeholder and never asks to update.
const code = await readFile(path.join(outputDirectory, "code.js"), "utf8");
// Exactly one spot (the define) may carry the placeholder, or stamping would rewrite other code too.
if (unstampedUi.split(buildPlaceholder).length !== 2) throw new Error("The plugin build placeholder must appear exactly once in ui.html.");
const buildId = separateOutput ? createHash("sha256").update(code).update(unstampedUi).digest("hex").slice(0, 12) : null;
const bundledUi = buildId ? unstampedUi.replaceAll(buildPlaceholder, buildId) : unstampedUi;
await Promise.all([
  writeFile(path.join(outputDirectory, "ui.html"), bundledUi),
  buildId ? writeFile(path.join(path.dirname(manifestPath), "build-id.txt"), `${buildId}\n`) : null,
  rm(path.join(outputDirectory, "ui.js"), { force: true }),
]);

const manifest = JSON.parse(await readFile(path.join(here, "manifest.template.json"), "utf8"));
// Only the capture route and its configured private Storage origin are available to the plugin.
manifest.networkAccess = networkAccess;
// The local dev copy gets its own name so it can't be mistaken for the production plugin teammates
// download from Integrations (the template build keeps the plain name).
if (!separateOutput) manifest.name = `${manifest.name} (Local)`;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Built Figma plugin for ${endpoint.origin} and ${storageOrigin}. Load ${path.relative(process.cwd(), manifestPath)} in Figma.\n`);
