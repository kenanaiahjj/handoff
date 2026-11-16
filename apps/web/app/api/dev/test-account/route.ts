import { z } from "zod";
import { bypassOffCookieName, isDevelopmentAuthBypassConfigured, viewAsCookieName } from "@/src/server/auth-session";
import { createDevTestAccount, deleteDevTestAccounts } from "@/src/server/services/dev-test-accounts";

const bodySchema = z.object({ name: z.string().max(100).optional() }).optional();

/**
 * Development only: signs this browser in as a brand-new company account so onboarding can be tried
 * again and again. POST makes a fresh account; DELETE removes all of them and returns to the owner.
 */
export async function POST(request: Request) {
  if (!isDevelopmentAuthBypassConfigured()) return Response.json({ error: "Not found." }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => undefined));
  const user = createDevTestAccount({ name: parsed.success ? parsed.data?.name : undefined });

  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", `${bypassOffCookieName}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`);
  headers.append("Set-Cookie", `${viewAsCookieName}=${encodeURIComponent(user.id)}; Path=/; SameSite=Lax`);
  return new Response(JSON.stringify({ user, redirectTo: "/onboarding" }), { status: 201, headers });
}

export async function DELETE() {
  if (!isDevelopmentAuthBypassConfigured()) return Response.json({ error: "Not found." }, { status: 404 });
  const result = deleteDevTestAccounts();
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", `${viewAsCookieName}=; Path=/; Max-Age=0; SameSite=Lax`);
  return new Response(JSON.stringify({ ...result, redirectTo: "/workspace" }), { headers });
}
