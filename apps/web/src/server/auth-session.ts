import { connection } from "next/server";
import type { AuthSession } from "./auth";
import { auth } from "./auth";
import { getDatabase } from "./db";

type DatabaseUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: number;
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

function getLocalTestUser(headers: Headers) {
  const database = getDatabase();
  const viewAsId = viewAsUserId(headers);
  if (viewAsId) {
    const viewAs = database
      .prepare('SELECT id, name, email, emailVerified, image, createdAt, updatedAt FROM "user" WHERE id = ?')
      .get(viewAsId) as DatabaseUser | undefined;
    if (viewAs) return viewAs;
  }
  const existing = database
    .prepare('SELECT id, name, email, emailVerified, image, createdAt, updatedAt FROM "user" WHERE id <> ? ORDER BY createdAt ASC, id ASC LIMIT 1')
    .get(localReviewerUser.id) as DatabaseUser | undefined;

  if (existing) return existing;

  const now = new Date().toISOString();
  const id = "asbir-local-flow-tester";
  database
    .prepare('INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, "Local flow tester", "local-flow-tester@asbir.invalid", 0, null, now, now);

  return database
    .prepare('SELECT id, name, email, emailVerified, image, createdAt, updatedAt FROM "user" WHERE id = ?')
    .get(id) as DatabaseUser;
}

function getLocalTestSession(headers: Headers): AuthSession {
  const user = getLocalTestUser(headers);
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
      emailVerified: Boolean(user.emailVerified),
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
    return getLocalTestSession(headers);
  }
  return auth.api.getSession({ headers });
}
