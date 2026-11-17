import { verifyLocalObjectToken } from "@/src/server/storage/local-object-store";
import { objectStore } from "@/src/server/storage/supabase-object-store";

function isLocalDevelopment() {
  return process.env.ASBIR_LOCAL_DEV_MODE === "1" && process.env.NODE_ENV === "development";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  if (!isLocalDevelopment()) return Response.json({ error: "Not found." }, { status: 404 });
  const { key } = await context.params;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!verifyLocalObjectToken("download", key, token)) {
    return Response.json({ error: "The signed download is invalid or expired." }, { status: 404 });
  }

  const stored = await objectStore.get(key);
  if (!stored) return Response.json({ error: "Asset not found." }, { status: 404 });

  const downloadName = new URL(request.url).searchParams.get("download")?.replace(/[\r\n"\\]/g, "_");
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Length": String(stored.bytes.byteLength),
    "Content-Type": stored.contentType,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  if (downloadName) headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);

  return new Response(Buffer.from(stored.bytes), { headers });
}
