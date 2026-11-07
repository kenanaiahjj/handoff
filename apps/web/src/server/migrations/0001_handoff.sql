create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");

CREATE TABLE workspace (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

CREATE TABLE workspace_membership (
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'designer', 'reviewer', 'developer', 'qa')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX workspace_membership_user_idx
  ON workspace_membership (user_id, workspace_id);

CREATE TABLE workspace_invite (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  invited_by_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'designer', 'reviewer', 'developer', 'qa')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX workspace_invite_workspace_idx
  ON workspace_invite (workspace_id, created_at DESC);
