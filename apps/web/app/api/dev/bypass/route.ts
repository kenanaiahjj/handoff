import { z } from "zod";
import { bypassOffCookieName, isDevelopmentAuthBypassConfigured, localReviewerUser, viewAsCookieName } from "@/src/server/auth-session";
import { getCompanyWorkspace } from "@/src/server/services/company-workspace";
import { ensureLocalReviewer } from "@/src/server/services/dev-test-accounts";

const bodySchema = z.object({ enabled: z.boolean(), as: z.enum(["owner", "reviewer"]).optional() });

/**
 * Development only: turns the local sign-in bypass off ("Sign out") or back on for this browser,
 * so real Google sign-in can be tried without editing .env.local. Not available in production.
 */
export async function POST(request: Request) {
  if (!isDevelopmentAuthBypassConfigured()) return Response.json({ error: "Not found." }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Say whether to turn the bypass on or off." }, { status: 400 });

  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append(
    "Set-Cookie",
    parsed.data.enabled
      ? `${bypassOffCookieName}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`
      : `${bypassOffCookieName}=1; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`,
  );
  // "Use local dev account" opens the populated reviewer home (Riley); "View as" can switch to Owner.
  const company = parsed.data.enabled && parsed.data.as === "reviewer" ? (await getCompanyWorkspace()) : null;
  if (company) {
    await ensureLocalReviewer(company.id, localReviewerUser);
    headers.append("Set-Cookie", `${viewAsCookieName}=${encodeURIComponent(localReviewerUser.id)}; Path=/; HttpOnly; SameSite=Lax`);
  } else {
    // Leaving the bypass (or entering as the owner) drops any "View as" choice.
    headers.append("Set-Cookie", `${viewAsCookieName}=; Path=/; Max-Age=0; SameSite=Lax`);
  }
  return new Response(JSON.stringify({ enabled: parsed.data.enabled }), { headers });
}
