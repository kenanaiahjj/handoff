/**
 * The app's public origin. Preview deployments may not set BETTER_AUTH_URL, so fall back to the
 * deployment URL, then localhost. No imports: the MCP route uses these without loading auth.
 */
export function publicOrigin() {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  if (configured) return new URL(configured).origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** AI clients sign in to this resource; access tokens are issued for (and only accepted by) /api/mcp. */
export function mcpResource() {
  return `${publicOrigin()}/api/mcp`;
}

/** Better Auth's issuer: the auth API's base URL. */
export function authIssuer() {
  return `${publicOrigin()}/api/auth`;
}

/** Where /api/mcp's 401 points clients to start sign-in (RFC 9728). */
export function protectedResourceMetadataUrl() {
  return `${publicOrigin()}/.well-known/oauth-protected-resource/api/mcp`;
}
