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

export function isDevelopmentAuthBypassEnabled() {
  return process.env.NODE_ENV === "development" && process.env.ASBIR_AUTH_BYPASS === "1";
}

function getLocalTestUser() {
  const database = getDatabase();
  const existing = database
    .prepare('SELECT id, name, email, emailVerified, image, createdAt, updatedAt FROM "user" ORDER BY createdAt ASC, id ASC LIMIT 1')
    .get() as DatabaseUser | undefined;

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

function getLocalTestSession(): AuthSession {
  const user = getLocalTestUser();
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
  if (isDevelopmentAuthBypassEnabled()) return getLocalTestSession();
  return auth.api.getSession({ headers });
}
