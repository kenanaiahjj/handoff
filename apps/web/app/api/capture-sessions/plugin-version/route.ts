import { readFile } from "node:fs/promises";
import path from "node:path";

// The Figma plugin calls this from its own origin, and its manifest only allows /api/capture-sessions/.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "600",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * The build id of the plugin Integrations hands out, so an installed copy can tell it's outdated.
 * Only a hash of the build, so no sign-in.
 */
export async function GET() {
  let build: string;
  try {
    build = (await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), "figma-plugin-template/build-id.txt"), "utf8")).trim();
  } catch {
    return Response.json({ error: "The plugin isn't built on this server yet." }, { status: 503, headers: corsHeaders });
  }
  return Response.json({ build }, { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
}
