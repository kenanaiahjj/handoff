import { createAuthClient } from "better-auth/react";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

/** oauthProviderClient carries an AI client's sign-in request through /sign-in and /oauth/consent. */
export const authClient = createAuthClient({ plugins: [oauthProviderClient()] });
