import { avatarMaxBytes, deleteAvatar, ProfileError, setAvatar } from "@/src/server/services/profiles";
import { getSessionForRequest } from "@/src/server/workspace-access";

/** Upload your photo: the raw image bytes as the request body (the browser crops it to 256 px). */
export async function PUT(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > avatarMaxBytes) {
    return Response.json({ error: "Photos can be up to 512 KB." }, { status: 413 });
  }
  try {
    return Response.json(await setAvatar(session.user.id, new Uint8Array(await request.arrayBuffer())));
  } catch (error) {
    if (error instanceof ProfileError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function DELETE(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  return Response.json(await deleteAvatar(session.user.id));
}
