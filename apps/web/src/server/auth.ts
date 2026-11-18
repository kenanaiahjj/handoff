import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { getDatabasePool } from "./db";
import { allowedEmailDomains, companyEmailDomains, isAllowedCompanyEmail } from "./services/onboarding";
import { isSuperadmin } from "./services/superadmins";

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const companyDomains = allowedEmailDomains();
/** Google's hosted-domain check: the one company domain, or any Workspace domain when there are several. */
const googleHostedDomain = companyDomains.length === 1 ? companyDomains[0] : companyDomains.length ? "*" : undefined;

export function isGoogleSignInEnabled() {
  return Boolean(googleClientId && googleClientSecret);
}

export const auth = betterAuth({
  database: getDatabasePool(),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  // Our own migrations own the schema (and the deploy preflight checks the auth tables). Better Auth's
  // runtime check introspects every table in the database before each auth request, and on a cold
  // Supabase connection it can fail and fail that sign-in with it.
  advanced: { database: { validateSchema: false } },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    // With Google on, new people join through Google; existing password accounts still sign in.
    disableSignUp: isGoogleSignInEnabled(),
  },
  socialProviders:
    googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            hd: googleHostedDomain,
            prompt: "select_account",
          },
        }
      : {},
  account: {
    // Someone who first signed up with a password can switch to Google with the same verified email.
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },
  databaseHooks: {
    user: {
      create: {
        async before(user) {
          if (!(await isAllowedCompanyEmail(user.email)) && !(await isSuperadmin(user.email))) {
            const domains = await companyEmailDomains();
            throw new APIError("FORBIDDEN", { message: `Sign in with your ${domains.map((domain) => "@" + domain).join(" or ")} account.` });
          }
        },
      },
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;
