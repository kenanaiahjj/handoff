import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.join(here, "dist");
const publicUrl = process.env.HANDOFF_PUBLIC_URL?.trim() || "http://localhost:3000";
const endpoint = new URL(publicUrl);
if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname))) {
  throw new Error("HANDOFF_PUBLIC_URL must use HTTPS outside local development.");
}

await mkdir(outputDirectory, { recursive: true });
const [, uiBuild] = await Promise.all([
  build({ entryPoints: [path.join(here, "src/code.ts")], outfile: path.join(outputDirectory, "code.js"), bundle: true, platform: "browser", format: "iife", target: ["es2022"] }),
  build({ entryPoints: [path.join(here, "src/ui.ts")], outfile: path.join(outputDirectory, "ui.js"), bundle: true, platform: "browser", format: "iife", target: ["es2022"], define: { __ASBIR_HANDOFF_ORIGIN__: JSON.stringify(endpoint.origin) }, write: false }),
]);

const uiSource = await readFile(path.join(here, "src/ui.html"), "utf8");
const uiScript = uiBuild.outputFiles.find((file) => file.path.endsWith("ui.js"))?.text;
const scriptTag = /<script\s+src=(['"])\.\/ui\.js\1\s*><\/script>/;
if (!uiScript || !scriptTag.test(uiSource)) throw new Error("The Figma UI bundle could not be embedded in ui.html.");
const safeUiScript = uiScript.replace(/<\/script/gi, "<\\/script");
const bundledUi = uiSource.replace(scriptTag, () => `<script>\n${safeUiScript}\n</script>`);
await Promise.all([
  writeFile(path.join(outputDirectory, "ui.html"), bundledUi),
  rm(path.join(outputDirectory, "ui.js"), { force: true }),
]);

const manifest = JSON.parse(await readFile(path.join(here, "manifest.template.json"), "utf8"));
const captureEndpoint = `${endpoint.origin}/api/capture-sessions/snapshot`;
manifest.networkAccess = {
  allowedDomains: [captureEndpoint],
  reasoning: "Upload one captured Figma canvas to the configured Asbir Handoff workspace.",
  devAllowedDomains: endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1" || endpoint.hostname === "[::1]"
    ? [endpoint.origin]
    : [],
};
await writeFile(path.join(here, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Built Figma plugin for ${endpoint.origin}. Load integrations/figma-plugin/manifest.json in Figma.\n`);
