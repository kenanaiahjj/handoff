import { getAvatar } from "@/src/server/services/profiles";
import { getSessionForRequest } from "@/src/server/workspace-access";

type AvatarRoute = { params: Promise<{ userId: string }> };

/** A teammate's photo, for anyone signed in (the app serves one company). */
export async function GET(request: Request, context: AvatarRoute) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const { userId } = await context.params;
  const avatar = await getAvatar(userId);
  if (!avatar) return Response.json({ error: "Not found." }, { status: 404 });
  const etag = `"${avatar.sha256.slice(0, 32)}"`;
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
  // The URL carries ?v=<fingerprint>, so a new photo gets a new URL.
  return new Response(new Uint8Array(avatar.bytes), {
    headers: {
      "Content-Type": avatar.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
