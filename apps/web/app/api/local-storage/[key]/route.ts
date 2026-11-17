import { verifyLocalObjectToken } from "@/src/server/storage/local-object-store";
import { objectStore } from "@/src/server/storage/supabase-object-store";

// The Figma plugin (origin "null") reads signed downloads, such as the previous canvas overview it
// merges into. Like Supabase's signed URLs, access is granted by the token, so any origin may read.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "600",
};

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: corsHeaders });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function isLocalDevelopment() {
  return process.env.ASBIR_LOCAL_DEV_MODE === "1" && process.env.NODE_ENV === "development";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  if (!isLocalDevelopment()) return json({ error: "Not found." }, 404);
  const { key } = await context.params;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!verifyLocalObjectToken("download", key, token)) {
    return json({ error: "The signed download is invalid or expired." }, 404);
  }

  const stored = await objectStore.get(key);
  if (!stored) return json({ error: "Asset not found." }, 404);

  const downloadName = new URL(request.url).searchParams.get("download")?.replace(/[\r\n"\\]/g, "_");
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Length": String(stored.bytes.byteLength),
    "Content-Type": stored.contentType,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...corsHeaders,
  });
  if (downloadName) headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);

  return new Response(Buffer.from(stored.bytes), { headers });
}
