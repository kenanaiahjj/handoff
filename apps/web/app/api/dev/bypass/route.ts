import { z } from "zod";
import { bypassOffCookieName, isDevelopmentAuthBypassConfigured, viewAsCookieName } from "@/src/server/auth-session";

const bodySchema = z.object({ enabled: z.boolean() });

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
  // Leaving the bypass also drops any "View as" choice.
  headers.append("Set-Cookie", `${viewAsCookieName}=; Path=/; Max-Age=0; SameSite=Lax`);
  return new Response(JSON.stringify({ enabled: parsed.data.enabled }), { headers });
}
