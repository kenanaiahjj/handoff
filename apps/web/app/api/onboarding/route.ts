import { z } from "zod";
import { completeOnboarding, isJobRole } from "@/src/server/services/onboarding";
import { getSessionForRequest } from "@/src/server/workspace-access";

const onboardingSchema = z.object({ jobRole: z.string().refine(isJobRole) });

/** Saves the role a new teammate picked and joins them to the company workspace. */
export async function POST(request: Request) {
  const session = await getSessionForRequest(request);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });

  const parsed = onboardingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isJobRole(parsed.data.jobRole)) {
    return Response.json({ error: "Choose what you do on the team." }, { status: 400 });
  }

  const joined = (await completeOnboarding(
    { id: session.user.id, email: session.user.email, emailVerified: session.user.emailVerified },
    parsed.data.jobRole,
  ));
  return Response.json({ joined, redirectTo: joined.length === 1 ? `/workspace/${joined[0].id}` : "/workspace" });
}
