import { betterAuth } from "better-auth";
import { getDatabase } from "./db";

export const auth = betterAuth({
  database: getDatabase(),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
  },
});

export type AuthSession = typeof auth.$Infer.Session;
