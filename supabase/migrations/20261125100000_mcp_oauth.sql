-- Sign in to the MCP server with OAuth (Better Auth jwt + @better-auth/oauth-provider 1.7.17).
-- AI clients (Claude Code, Codex, …) register themselves, open a browser, the person signs in and
-- allows access, and the client gets a short-lived JWT for /api/mcp. No copying tokens around.
-- Column names and types follow the plugins' own schema; string[] columns hold JSON text.

CREATE TABLE jwks (
  id text PRIMARY KEY,
  "publicKey" text NOT NULL,
  "privateKey" text NOT NULL,
  "createdAt" timestamptz NOT NULL,
  "expiresAt" timestamptz,
  alg text,
  crv text
);

CREATE TABLE "oauthClient" (
  id text PRIMARY KEY,
  "clientId" text NOT NULL UNIQUE,
  "clientSecret" text,
  "clientDiscoveryId" text,
  disabled boolean DEFAULT false,
  "skipConsent" boolean,
  "enableEndSession" boolean,
  "subjectType" text,
  scopes text,
  "clientCredentialsScopes" text,
  "userId" text REFERENCES "user" (id) ON DELETE CASCADE,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  name text,
  uri text,
  icon text,
  contacts text,
  tos text,
  policy text,
  "softwareId" text,
  "softwareVersion" text,
  "softwareStatement" text,
  "redirectUris" text NOT NULL,
  "postLogoutRedirectUris" text,
  "backchannelLogoutUri" text,
  "backchannelLogoutSessionRequired" boolean,
  "tokenEndpointAuthMethod" text,
  "applicationType" text,
  jwks text,
  "jwksUri" text,
  "grantTypes" text,
  "responseTypes" text,
  "requirePKCE" boolean,
  "dpopBoundAccessTokens" boolean DEFAULT false,
  "referenceId" text,
  metadata jsonb
);

CREATE TABLE "oauthResource" (
  id text PRIMARY KEY,
  identifier text NOT NULL UNIQUE,
  name text NOT NULL,
  "accessTokenTtl" integer,
  "refreshTokenTtl" integer,
  "signingAlgorithm" text,
  "signingKeyId" text,
  "allowedScopes" text,
  "customClaims" jsonb,
  "dpopBoundAccessTokensRequired" boolean DEFAULT false,
  disabled boolean DEFAULT false,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "policyVersion" integer DEFAULT 1,
  metadata jsonb
);

CREATE TABLE "oauthClientResource" (
  id text PRIMARY KEY,
  "clientId" text NOT NULL REFERENCES "oauthClient" ("clientId") ON DELETE CASCADE,
  "resourceId" text NOT NULL REFERENCES "oauthResource" (identifier) ON DELETE CASCADE,
  metadata jsonb,
  "createdAt" timestamptz
);

CREATE TABLE "oauthRefreshToken" (
  id text PRIMARY KEY,
  token text NOT NULL UNIQUE,
  "clientId" text NOT NULL REFERENCES "oauthClient" ("clientId") ON DELETE CASCADE,
  "sessionId" text REFERENCES session (id) ON DELETE SET NULL,
  "userId" text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  "referenceId" text,
  "authorizationCodeId" text,
  resources text,
  "requestedUserInfoClaims" text,
  "expiresAt" timestamptz,
  "createdAt" timestamptz,
  revoked timestamptz,
  "rotatedAt" timestamptz,
  "rotationReplayResponse" text,
  "rotationReplayExpiresAt" timestamptz,
  "authTime" timestamptz,
  confirmation jsonb,
  scopes text NOT NULL
);

CREATE TABLE "oauthAccessToken" (
  id text PRIMARY KEY,
  token text UNIQUE,
  "clientId" text NOT NULL REFERENCES "oauthClient" ("clientId") ON DELETE CASCADE,
  "sessionId" text REFERENCES session (id) ON DELETE SET NULL,
  "userId" text REFERENCES "user" (id) ON DELETE CASCADE,
  "referenceId" text,
  "authorizationCodeId" text,
  resources text,
  "requestedUserInfoClaims" text,
  "refreshId" text REFERENCES "oauthRefreshToken" (id) ON DELETE CASCADE,
  "expiresAt" timestamptz,
  "createdAt" timestamptz,
  revoked timestamptz,
  confirmation jsonb,
  scopes text NOT NULL
);

CREATE TABLE "oauthConsent" (
  id text PRIMARY KEY,
  "clientId" text NOT NULL REFERENCES "oauthClient" ("clientId") ON DELETE CASCADE,
  "userId" text REFERENCES "user" (id) ON DELETE CASCADE,
  "referenceId" text,
  resources text,
  "requestedUserInfoClaims" text,
  scopes text NOT NULL,
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE TABLE "oauthClientAssertion" (
  id text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL
);

CREATE INDEX "oauthClientResource_clientId_idx" ON "oauthClientResource" ("clientId");
CREATE INDEX "oauthRefreshToken_userId_idx" ON "oauthRefreshToken" ("userId");
CREATE INDEX "oauthAccessToken_userId_idx" ON "oauthAccessToken" ("userId");
CREATE INDEX "oauthConsent_userId_clientId_idx" ON "oauthConsent" ("userId", "clientId");

ALTER TABLE jwks ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauthClient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauthResource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauthClientResource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauthRefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauthAccessToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauthConsent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauthClientAssertion" ENABLE ROW LEVEL SECURITY;
