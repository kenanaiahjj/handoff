import { z } from "zod";
import { getProfile, ProfileError, updateProfile } from "@/src/server/services/profiles";
import { getSessionForRequest } from "@/src/server/workspace-access";

const field = z.string().nullable().optional();
const profileSchema = z.object({ name: z.string().optional(), title: field, department: field, pronouns: field, timezone: field, bio: field });

/** The signed-in person's own profile. */
export async function GET(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  return Response.json({ profile: await getProfile(session.user.id) });
}

export async function PATCH(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Check the profile fields and try again." }, { status: 400 });
  try {
    return Response.json({ profile: await updateProfile(session.user.id, parsed.data) });
  } catch (error) {
    if (error instanceof ProfileError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
