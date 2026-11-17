import { connection } from "next/server";
import type { AuthSession } from "./auth";
import { auth } from "./auth";
import { getDatabase } from "./db";

type DatabaseUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Set by "Sign out" in development so this browser uses real sign-in while the bypass is on. */
export const bypassOffCookieName = "asbir_bypass_off";

function hasBypassOffCookie(cookieHeader: string | null) {
  return (cookieHeader ?? "").split(/;\s*/).includes(`${bypassOffCookieName}=1`);
}

/** Whether ASBIR_AUTH_BYPASS is configured at all (development only). */
export function isDevelopmentAuthBypassConfigured() {
  return process.env.NODE_ENV === "development" && process.env.ASBIR_AUTH_BYPASS === "1";
}

/**
 * Whether this request uses the local bypass account. Pass the request headers; without them only
 * the configuration is checked. A browser that signed out has opted back into real sign-in.
 */
export function isDevelopmentAuthBypassEnabled(headers?: Headers) {
  if (!isDevelopmentAuthBypassConfigured()) return false;
  return !headers || !hasBypassOffCookie(headers.get("cookie"));
}

/** For server components: reads this request's cookies. */
export async function isDevelopmentAuthBypassActive() {
  if (!isDevelopmentAuthBypassConfigured()) return false;
  const { headers } = await import("next/headers");
  return isDevelopmentAuthBypassEnabled(await headers());
}

export const viewAsCookieName = "asbir_view_as";
export const localReviewerUser = { id: "asbir-local-reviewer", name: "Riley Reviewer", email: "reviewer@asbir.invalid" };

function viewAsUserId(headers: Headers) {
  const cookie = headers.get("cookie") ?? "";
  const match = cookie.split(/;\s*/).find((part) => part.startsWith(viewAsCookieName + "="));
  return match ? decodeURIComponent(match.slice(viewAsCookieName.length + 1)) : null;
}

async function getLocalTestUser(headers: Headers) {
  const database = getDatabase();
  const viewAsId = viewAsUserId(headers);
  if (viewAsId) {
    const viewAs = (await database
      .prepare('SELECT id, name, email, emailVerified, image, createdAt, updatedAt FROM "user" WHERE id = ?')
      .get(viewAsId)) as DatabaseUser | undefined;
    if (viewAs) return viewAs;
  }
  const existing = (await database
    .prepare('SELECT id, name, email, emailVerified, image, createdAt, updatedAt FROM "user" WHERE id <> ? ORDER BY createdAt ASC, id ASC LIMIT 1')
    .get(localReviewerUser.id)) as DatabaseUser | undefined;

  if (existing) return existing;

  const now = new Date().toISOString();
  const id = "asbir-local-flow-tester";
  (await database
    .prepare('INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, "Local flow tester", "local-flow-tester@asbir.invalid", false, null, now, now));

  return (await database
    .prepare('SELECT id, name, email, emailVerified, image, createdAt, updatedAt FROM "user" WHERE id = ?')
    .get(id)) as DatabaseUser;
}

async function getLocalTestSession(headers: Headers): Promise<AuthSession> {
  const user = (await getLocalTestUser(headers));
  const now = new Date();

  return {
    session: {
      id: "asbir-local-flow-session",
      token: "asbir-local-flow-session",
      userId: user.id,
      expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    },
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      createdAt: new Date(user.createdAt),
      updatedAt: new Date(user.updatedAt),
    },
  } satisfies AuthSession;
}

export async function getSessionForHeaders(headers: Headers) {
  if (isDevelopmentAuthBypassEnabled(headers)) {
    // The bypass session is built from the clock, so mark the render as request-time.
    await connection();
    return (await getLocalTestSession(headers));
  }
  return auth.api.getSession({ headers });
}

/** Which "View as" choice is showing: the owner, the seeded reviewer, or a throwaway test account. */
export function viewAsModeFor(user: { email: string }): "owner" | "reviewer" | "test" {
  // Throwaway accounts from "Use fresh account" look like "alex.test.1a2b3c@company.com".
  if (/\.test\.[0-9a-f]{6}@/.test(user.email)) return "test";
  return user.email === localReviewerUser.email ? "reviewer" : "owner";
}
