// Builds the Figma plugin once with placeholder addresses. The download route
// (app/api/figma-plugin/route.ts) swaps in this server's real addresses and zips it,
// so teammates get a plugin that already points at the right place.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(webRoot, "../..");

execFileSync(process.execPath, [path.join(repositoryRoot, "integrations/figma-plugin/build.mjs")], {
  cwd: path.join(repositoryRoot, "integrations/figma-plugin"),
  stdio: "inherit",
  env: {
    ...process.env,
    PLUGIN_OUT_DIR: path.join(webRoot, "figma-plugin-template"),
    HANDOFF_PUBLIC_URL: "https://asbir-handoff-origin.invalid",
    SUPABASE_URL: "https://asbir-storage-origin.invalid",
    SUPABASE_STORAGE_URL: "https://asbir-storage-origin.invalid",
  },
});
