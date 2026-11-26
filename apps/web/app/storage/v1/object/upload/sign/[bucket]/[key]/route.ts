import { getDatabase } from "@/src/server/db";
import { verifyLocalObjectToken } from "@/src/server/storage/local-object-store";
import { objectStore } from "@/src/server/storage/supabase-object-store";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "600",
  "Cache-Control": "no-store",
};

function isLocalDevelopment() {
  return process.env.ASBIR_LOCAL_DEV_MODE === "1" &&
    (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test");
}

function response(status: number, body = "") {
  return new Response(body, { status, headers: corsHeaders });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function readUploadBody(request: Request, expectedBytes: number) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > expectedBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes !== expectedBytes) return null;
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function implementationCheckUpload(contentType: string, contentLength: string | null) {
  const size = Number(contentLength);
  if (!["image/png", "image/jpeg", "image/webp"].includes(contentType) || !Number.isSafeInteger(size) || size < 1 || size > 15 * 1024 * 1024) return undefined;
  return { sizeBytes: size, contentType };
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ bucket: string; key: string }> },
) {
  if (!isLocalDevelopment()) return response(404, "Not found.");
  const { bucket, key } = await context.params;
  const expectedBucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "handoff-assets";
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (bucket !== expectedBucket || !verifyLocalObjectToken("upload", key, token)) {
    return response(401, "The signed upload is invalid or expired.");
  }

  const contentType = request.headers.get("content-type")?.trim() ?? "";
  const expected = await getDatabase().prepare(
    `SELECT upload.size_bytes AS sizeBytes, upload.content_type AS contentType
     FROM capture_upload AS upload
     JOIN capture_session AS session ON session.id = upload.capture_session_id
     WHERE upload.object_key = ? AND upload.finalized_at IS NULL
       AND session.used_at IS NULL AND session.expires_at > ?
     UNION ALL
     SELECT size_bytes AS sizeBytes, content_type AS contentType
     FROM package_import_upload
     WHERE object_key = ? AND finalized_at IS NULL AND expires_at > ?
     LIMIT 1`,
  ).get(key, new Date().toISOString(), key, new Date().toISOString()) as
    { sizeBytes: number; contentType: string } | undefined
    // MCP check_implementation screenshots have no declaration row; Supabase's signed URL alone allows them.
    ?? implementationCheckUpload(contentType, request.headers.get("content-length"));

  if (!expected) return response(404, "The upload is no longer available.");
  if (contentType !== expected.contentType) return response(415, "The content type does not match the upload declaration.");
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader && Number(contentLengthHeader) !== expected.sizeBytes) {
    return response(400, "The upload size does not match its declaration.");
  }

  const bytes = await readUploadBody(request, expected.sizeBytes);
  if (!bytes) return response(413, "The upload size does not match its declaration.");

  try {
    await objectStore.put(key, bytes, contentType);
    return response(201);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return response(409, "The object already exists.");
    console.error("[local-storage] upload failed", error);
    return response(503, "The local upload could not be stored.");
  }
}
