import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { auth } from "../auth";
import { authIssuer, mcpResource } from "./urls";

/** RFC 8414 / OpenID discovery for the Better Auth issuer, served at the paths AI clients probe. */
export const authorizationServerMetadata = oauthProviderAuthServerMetadata(auth);
export const openIdConfiguration = oauthProviderOpenIdConfigMetadata(auth);

/** RFC 9728: tells an AI client that /api/mcp is protected and where to sign in. */
export function protectedResourceMetadata() {
  return Response.json(
    {
      resource: mcpResource(),
      authorization_servers: [authIssuer()],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "profile", "email", "offline_access"],
      resource_name: "Asbir Handoff",
    },
    { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } },
  );
}
