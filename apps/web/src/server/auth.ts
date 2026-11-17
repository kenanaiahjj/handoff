import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { getDatabasePool } from "./db";
import { allowedEmailDomains, isAllowedEmail } from "./services/onboarding";
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
          if (!isAllowedEmail(user.email) && !(await isSuperadmin(user.email))) {
            throw new APIError("FORBIDDEN", { message: `Sign in with your ${companyDomains.map((domain) => "@" + domain).join(" or ")} account.` });
          }
        },
      },
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;
