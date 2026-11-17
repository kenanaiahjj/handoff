# Vercel + Supabase Migration Implementation Plan

> **For agentic workers:** Use the executing-plans workflow to implement this plan task by task. Track each step with a checkbox.

**Goal:** Run Asbir Handoff on Vercel with Supabase Postgres and Storage, keep Better Auth, and preserve the Figma plugin and package-import workflows.

**Architecture:** Deploy the Next.js app as Node.js functions on Vercel. Move relational data to Supabase Postgres and binary assets to a private Supabase Storage bucket. Keep Better Auth and the app’s authorization checks. For large uploads, the app issues scoped Storage upload credentials; the Figma plugin uploads directly to Storage and sends a small manifest to the app to validate and commit.

**Tech stack:** Next.js App Router, Better Auth, PostgreSQL through the Supabase transaction pooler, Supabase Storage, the Supabase CLI for schema migrations, and TUS resumable uploads for large plugin files.

## Global constraints

- Keep the current Better Auth provider and Google sign-in. Replacing Better Auth with Supabase Auth is a separate design decision.
- Preserve account IDs, password hashes, OAuth account records, workspace permissions, immutable versions, snapshot contracts, partial-capture merge behavior, and public review behavior.
- Keep database and Supabase service-role credentials in server-side environment variables. Never place them in the Figma bundle or browser code.
- Keep the Storage bucket private. Require app authorization before issuing signed download links.
- Do not send large capture or package bytes through Vercel Function request or response bodies. Vercel documents a 4.5 MB body limit; current capture limits allow up to 256 MiB of render assets and 128 MiB of snapshot JSON.
- Apply schema changes through versioned Supabase migrations, not during function startup.
- Keep the SQLite database and local object directory intact until migration verification and the rollback window are complete.
- Preserve app-route behavior and the snapshot contract while moving persistence.

## Current architecture and migration boundary

The app is a Next.js 16 workspace under apps/web. It uses synchronous better-sqlite3 access through getDatabase(), applies SQLite migrations at startup, and performs snapshot compression and index refreshes during database initialization. The codebase graph shows 149 callers of getDatabase(). The source inventory contains 56 non-test app and server files with direct SQLite calls, plus scripts/seed-sample-projects.mjs. Twenty-five test files currently import better-sqlite3.

Asset bytes live in LocalObjectStore. The asset API, public-review asset API, Figma baseline endpoint, and MCP tools read full objects through the app. Two package-import routes accept multipart files directly. These paths need changes because Vercel Function request and response bodies share the 4.5 MB limit.

The Figma plugin currently sends snapshot JSON and render files as one multipart request to /api/capture-sessions/snapshot. Its generated manifest allows only the app capture route. The plugin needs direct Storage uploads and access to the project’s Storage host while keeping its one-time capture-token flow.

The repository’s docs/vercel-deployment.md says the Vercel project exists but is not connected to GitHub or deployed. Docker Compose remains the current persistent-disk deployment path.

## Target upload and asset flow

~~~mermaid
sequenceDiagram
    participant P as Figma plugin or browser
    participant V as Vercel app
    participant S as Supabase Storage
    participant D as Supabase Postgres

    P->>V: Request upload credentials with app authorization
    V->>D: Validate workspace or one-time capture session
    V-->>P: Return scoped upload paths and signed credentials
    P->>S: Upload large objects directly, using TUS when appropriate
    P->>V: Send a small manifest to finalize
    V->>S: Verify uploaded objects and snapshot content
    V->>D: Commit version metadata in one transaction
    V-->>P: Return the review URL
    P->>V: Request a protected asset
    V-->>P: Authorize and return a signed Storage URL
    P->>S: Read the private object
~~~

## Task 1: Add the Supabase schema and local Postgres test environment

**Files:**

- Create: supabase/config.toml
- Create: supabase/migrations/20261117000000_asbir_baseline.sql
- Create: supabase/seed.sql
- Read as migration input: apps/web/src/server/migrations/*.sql

- [ ] Start a local Supabase stack with supabase start.
- [ ] Build a clean Postgres baseline migration from the current SQLite schema and installed Better Auth schema. Keep the current table and column contract where practical.
- [ ] Convert SQLite-only behavior deliberately: BLOB to BYTEA, integer flags to booleans, JSON text checks to JSONB where appropriate, INSERT OR IGNORE to ON CONFLICT, SQLite date functions to PostgreSQL timestamps, and SQLite triggers to PostgreSQL trigger functions.
- [ ] Preserve the immutable-version rule, including the allowed transition that replaces a snapshot row’s plain JSON with {} after its compressed copy is stored.
- [ ] Create a private handoff-assets bucket with MIME-type and per-file limits supported by the selected Supabase plan. Keep the 256 MiB aggregate render-asset limit in app validation.
- [ ] Revoke direct table access from Supabase Data API roles and enable RLS on exposed app tables. The Vercel server uses a server-only database role; browser code continues to call app routes.
- [ ] Add test-only seed data. Do not use production IDs or secrets in supabase/seed.sql.
- [ ] Apply the schema from an empty local database with supabase db reset.

**Validation:** supabase db reset completes without migration errors. A clean local Postgres database contains the app and Better Auth tables, constraints, indexes, trigger, RLS settings, and private bucket.

## Task 2: Move the relational layer from SQLite to Postgres

**Files:**

- Modify: apps/web/package.json
- Modify: apps/web/next.config.ts
- Modify: apps/web/src/server/db.ts
- Modify: apps/web/src/server/auth.ts
- Modify: every source file in Appendix A
- Modify: scripts/seed-sample-projects.mjs
- Modify: every test file in Appendix B
- Create: apps/web/src/server/test-support/postgres-test-database.mjs
- Keep: apps/web/src/server/migrations/*.sql as historical SQLite migration input until production import is verified

- [ ] Add pg and its TypeScript types. Keep better-sqlite3 as a development dependency for the data importer and SQLite-source fixtures; do not bundle it into Vercel functions.
- [ ] Replace getDatabase() with a module-scoped Postgres pool configured for Supabase’s shared transaction pooler. Start with one connection per warm function instance, require TLS, and avoid session state or named prepared statements that the pooler does not support.
- [ ] Export typed query and explicit transaction helpers from apps/web/src/server/db.ts. Use the same Postgres pool for Better Auth and app queries where the adapters permit it.
- [ ] Configure Better Auth to use its PostgreSQL adapter without changing Google sign-in, allowed-domain, password, or account-linking behavior.
- [ ] Convert every Appendix A caller from synchronous SQLite operations to asynchronous Postgres queries. Convert placeholders, RETURNING behavior, ON CONFLICT handling, JSON functions, booleans, timestamps, and uniqueness errors to PostgreSQL equivalents.
- [ ] Convert workspace access, membership, invite, handoff, version, snapshot, review, notification, cache, MCP, and integration queries in the same change set. These features share user and workspace rows, so do not deploy a partial database conversion.
- [ ] Preserve transaction boundaries, role checks, ordering, optimistic version checks, atomic capture-session consumption, and public-review access decisions.
- [ ] Keep Brotli compression. Store compressed snapshots as BYTEA and frame indexes as JSONB or typed text. Remove compression and index refresh from cold-start initialization; move required backfills to an explicit restartable script.
- [ ] Add a Postgres test helper that connects only to a dedicated local test database and resets fixtures between tests. Convert the Appendix B tests to PostgreSQL fixtures; replace SQLite migration-mechanics tests with Postgres migration and immutability tests.
- [ ] Keep old SQLite migration files available to the data importer, but stop running them during app startup.
- [ ] After all production source imports use Postgres, remove better-sqlite3 from serverExternalPackages and run npm test, npm run lint --workspace @asbir/web, and npm run build --workspace @asbir/web.

**Validation:** All app tests pass against PostgreSQL and continue to cover roles, invitations, comments, notifications, immutable versions, capture sessions, partial merges, comparisons, snapshots, and MCP access. A cold Vercel function start does not create local files or run DDL.

## Task 3: Move object storage to a private Supabase bucket

**Files:**

- Modify: apps/web/src/server/storage/object-store.ts
- Create: apps/web/src/server/storage/supabase-object-store.ts
- Retire from production use: apps/web/src/server/storage/local-object-store.ts
- Modify: apps/web/app/api/assets/[assetKey]/route.ts
- Modify: apps/web/app/api/review/[shareId]/assets/[assetKey]/route.ts
- Modify: apps/web/app/api/capture-sessions/baseline-overview/route.ts
- Modify: apps/web/app/api/mcp/route.ts
- Modify: apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/route.ts
- Modify: apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/versions/[versionId]/route.ts
- Modify: apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/icon/route.ts
- Modify: storage, asset, and MCP tests listed in Appendix B

- [ ] Implement SupabaseObjectStore with server-side put, get, and delete behavior. Preserve the current object-key format so imported asset references remain stable.
- [ ] Add signed upload and download methods. Use the private handoff-assets bucket and keep its service-role key server-side.
- [ ] Run existing app and published-review authorization checks before creating signed downloads. Signed links must refer only to objects authorized for the request.
- [ ] Preserve metadata checks and SHA-256 validation during upload finalization. Do not proxy every asset through Vercel for normal image views.
- [ ] Change the baseline-overview endpoint to return a signed Storage reference with the current version metadata. Update the Figma plugin to fetch that image from Storage.
- [ ] Keep MCP image responses below Vercel’s response limit. Return inline images only under a conservative limit below 4.5 MB; return a protected, time-limited download link for larger renders.
- [ ] Preserve ETag, cache, Content-Disposition, Referrer-Policy, and SVG protections. If signed Storage responses cannot provide the current SVG headers, keep a size-limited app response for SVG or serve a sanitized raster preview.
- [ ] Keep project-icon uploads on the app route with a strict request-size limit below 4.5 MB.
- [ ] Delete objects only after database references are removed or committed. Clean up abandoned staging objects and failed finalizations.

**Validation:** Authorized users and published reviewers can view or download the same assets as before. Unauthorized users cannot obtain signed URLs. Storage objects remain private, and delete flows remove only unreferenced keys.

## Task 4: Replace large multipart uploads with signed direct uploads

**Files:**

- Create: apps/web/app/api/capture-sessions/uploads/route.ts
- Modify: apps/web/app/api/capture-sessions/snapshot/route.ts
- Modify: apps/web/app/api/capture-sessions/baseline-overview/route.ts
- Create: apps/web/app/api/uploads/route.ts
- Modify: apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/route.ts
- Modify: apps/web/app/api/workspaces/[workspaceId]/handoffs/[handoffId]/versions/route.ts
- Modify: apps/web/src/server/repositories/capture-sessions.ts
- Modify: apps/web/src/server/services/import-snapshot.ts
- Modify: integrations/figma-plugin/package.json
- Modify: integrations/figma-plugin/src/ui.ts
- Modify: integrations/figma-plugin/src/ui.html
- Modify: integrations/figma-plugin/build.mjs
- Modify: integrations/figma-plugin/manifest.template.json
- Add focused tests under apps/web/app/api/capture-sessions/ and integrations/figma-plugin/test/
- Update: docs/figma-plugin.md and docs/figma-capture.md

- [ ] Define the Figma upload-intent contract. The plugin sends its one-time capture token and asset descriptors; the route verifies the session and returns unique staging paths, upload tokens, the Storage endpoint, and file constraints.
- [ ] Scope each signed upload path to one capture session and one asset. Reject unexpected MIME types, duplicate asset keys, oversize declarations, expired sessions, and attempts to reuse a finalized session.
- [ ] Preserve the current one-hour capture-token behavior. Add a session renewal step for an upload that began before expiry and remains active, and reject renewal after finalization or loss of workspace authorization.
- [ ] Add TUS upload support in the plugin for files larger than 6 MB. Keep single-request signed uploads for smaller files only if they use the same validation path.
- [ ] Update the generated Figma manifest to allow only the configured Handoff capture route and exact Supabase Storage host. Configure Storage CORS for app origins that need direct browser downloads.
- [ ] Change /api/capture-sessions/snapshot to accept a small JSON manifest of uploaded object paths, snapshot metadata, baseline version, and confirmed frame matches. The route fetches and validates the snapshot, verifies asset metadata and integrity, preserves partial-capture merging, commits the version, consumes the token, and cleans up unreferenced staging files.
- [ ] Change package import routes to use the same authenticated upload-intent pattern for large ZIP packages. The app validates and imports from Storage after upload. Keep the small project-icon route with an explicit limit.
- [ ] Add progress, retry, cancellation, and failure recovery to the plugin UI. A retry must reuse the captured snapshot and must not create a second handoff version.
- [ ] Add tests for expired and reused tokens, missing and extra objects, mismatched MIME type, size and checksum, TUS completion, interrupted-upload retry, partial merges, and duplicate finalization.
- [ ] Run npm test, npm run lint --workspace @asbir/figma-plugin, and npm run build --workspace @asbir/figma-plugin with staging HANDOFF_PUBLIC_URL and SUPABASE_URL values.

**Validation:** The plugin can upload a capture whose total payload exceeds 4.5 MB without sending those bytes to a Vercel Function. A selected-frame update still preserves uncaptured frames, and the server rejects forged or mismatched upload manifests.

## Task 5: Migrate existing SQLite data and object files

**Files:**

- Create: scripts/migrate-sqlite-to-supabase.mjs
- Create: scripts/verify-supabase-migration.mjs
- Create: scripts/migrate-sqlite-to-supabase.test.mjs
- Modify: package.json
- Update: docs/vercel-deployment.md

- [ ] Read the source SQLite file and object directory from explicit arguments or migration-only environment variables. Do not read app .env.local implicitly.
- [ ] Import tables in foreign-key order while preserving primary keys, Better Auth user/account/session rows, workspace membership, capture sessions, immutable versions, comments, links, and timestamps.
- [ ] Convert SQLite JSON and boolean representations to the target PostgreSQL representation. Import compressed snapshots as BYTEA and preserve frame indexes.
- [ ] Copy referenced objects into the private Storage bucket under existing object_key values. Verify stored size, content type, and SHA-256 before marking each object complete.
- [ ] Make the importer restartable with durable checkpoints and conflict-safe writes. A second run must not duplicate users, versions, asset references, comments, or Storage objects.
- [ ] Add a dry-run mode that reports row counts, missing objects, checksum mismatches, and orphaned local files without writing to Supabase.
- [ ] Add a verifier that compares SQLite and Postgres row counts by table, checks foreign keys and immutable-version references, and compares object checksums.
- [ ] Test with a disposable local Supabase project and sanitized SQLite fixture before using production credentials.
- [ ] Keep the original volume and verified database/object backup read-only throughout the rollback window.

**Validation:** The migration can stop and resume without duplicates. The verifier reports no missing referenced objects, no checksum mismatches, and matching row counts for migrated tables.

## Task 6: Configure Vercel and update deployment and plugin documentation

**Files:**

- Modify: apps/web/.env.example
- Modify: deployment.env.example
- Modify: apps/web/next.config.ts
- Modify: README.md
- Modify: deploy/README.md
- Modify: docs/vercel-deployment.md
- Modify: docs/figma-plugin.md
- Modify: docs/figma-capture.md
- Modify: integrations/figma-plugin/build.mjs
- Modify: integrations/figma-plugin/manifest.template.json

- [ ] Confirm the workspace package manager before linking Vercel. This checkout has an untracked pnpm-lock.yaml; review its ownership and choose the lockfile to commit before configuring Vercel installs.
- [ ] Configure the existing Vercel project for the repository’s workspace layout and Next.js app. Verify install and build commands against the selected lockfile before connecting GitHub.
- [ ] Add server-side Vercel variables for DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BETTER_AUTH_URL, BETTER_AUTH_SECRET, Google OAuth, allowed email domains, company name, and enabled Slack or OpenAI integrations.
- [ ] Set ASBIR_AUTH_BYPASS=0 in Preview and Production. Keep the Supabase service credential out of NEXT_PUBLIC variables.
- [ ] Use the Supabase transaction-pooler URI for Vercel functions. Align the Vercel Node.js function region with the selected Supabase database region.
- [ ] Configure Google OAuth to use the production Better Auth callback and deployed app origin.
- [ ] Build the Figma plugin for the deployed app origin and Supabase Storage host. Confirm the generated manifest includes only the required hosts and no credentials.
- [ ] Replace deployment instructions that require ASBIR_DATA_DIR, a persistent SQLite volume, and Litestream. Keep Docker/Railway files only as alternate app-hosting options that use the same Postgres and Storage services.
- [ ] Document local Supabase setup, environment variables, migration command, direct-upload behavior, and production rollback procedure.

**Validation:** A Vercel Preview deployment builds from the monorepo, connects only to staging Supabase, and survives separate function invocations without local disk state.

## Task 7: Verify staging and cut over production

**Files:**

- Update: docs/vercel-deployment.md with the verified cutover and rollback procedure
- Update: docs/figma-plugin.md with the verified production build command

- [ ] Run supabase db reset.
- [ ] Run npm test.
- [ ] Run npm run lint --workspace @asbir/web.
- [ ] Run npm run lint --workspace @asbir/figma-plugin.
- [ ] Run npm run build --workspace @asbir/web.
- [ ] Build the plugin with staging app and Storage URLs, then load the generated manifest in Figma Desktop.
- [ ] In Preview, test sign-in, workspace permissions, invitations, comments and annotations, published reviews, version switching, package import, project icons, MCP tools, and data persistence across separate function invocations.
- [ ] In Preview, test full-file capture, selected-page update, a direct Storage upload larger than 6 MB, interrupted-upload retry, expired and reused tokens, and invalid manifests. Verify file bytes do not pass through a Vercel Function request.
- [ ] Test protected asset reads, reviewer links, SVG headers, Storage CORS, MCP responses below the Vercel response limit, and cleanup of abandoned staging objects.
- [ ] Before production cutover, take a fresh SQLite backup and object-directory copy. Freeze writes, run the final incremental import, run the verifier, and deploy Vercel against production Supabase.
- [ ] Verify health, existing account access, a saved handoff, comments, a Figma capture, and private asset reads. Keep the old deployment and backup read-only until the rollback window ends.
- [ ] If verification fails before users write to the new system, restore the old deployment and unfreeze writes. If users have written to Supabase, keep Vercel read-only until those writes are preserved before rollback.

**Completion criteria:** All production records and referenced objects are present in Supabase, app and Figma workflows pass in Vercel, private assets remain protected, and the old volume has not been deleted before the rollback window ends.

## Appendix A: Current non-test SQLite source callsites

The database conversion must cover each path:

- apps/web/app/api/assets/[assetKey]/route.ts
- apps/web/app/api/capture-sessions/baseline-overview/route.ts
- apps/web/app/api/capture-sessions/preview/route.ts
- apps/web/app/api/capture-sessions/route.ts
- apps/web/app/api/capture-sessions/snapshot/route.ts
- apps/web/app/api/dev/view-as/route.ts
- apps/web/app/api/health/route.ts
- apps/web/app/api/invites/[token]/route.ts
- apps/web/app/api/me/badge/route.ts
- apps/web/app/api/review/[shareId]/versions/[versionId]/comments/route.ts
- apps/web/app/api/review/[shareId]/versions/[versionId]/findings/route.ts
- apps/web/app/api/superadmins/route.ts
- apps/web/app/api/workspaces/[workspaceId]/handoffs/[handoffId]/versions/route.ts
- apps/web/app/api/workspaces/[workspaceId]/invites/[inviteId]/route.ts
- apps/web/app/api/workspaces/[workspaceId]/invites/route.ts
- apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/compare/route.ts
- apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/versions/[versionId]/comments/route.ts
- apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/versions/[versionId]/findings/route.ts
- apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/route.ts
- apps/web/app/api/workspaces/route.ts
- apps/web/app/workspace/[workspaceId]/integrations/page.tsx
- apps/web/app/workspace/[workspaceId]/page.tsx
- apps/web/app/workspace/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/page.tsx
- apps/web/app/workspace/[workspaceId]/projects/[projectId]/page.tsx
- apps/web/app/workspace/[workspaceId]/projects/page.tsx
- apps/web/app/workspace/page.tsx
- apps/web/src/server/auth-session.ts
- apps/web/src/server/auth.ts
- apps/web/src/server/db.ts
- apps/web/src/server/repositories/annotations.ts
- apps/web/src/server/repositories/capture-sessions.ts
- apps/web/src/server/repositories/changelogs.ts
- apps/web/src/server/repositories/comments.ts
- apps/web/src/server/repositories/findings.ts
- apps/web/src/server/repositories/handoffs.ts
- apps/web/src/server/repositories/linked-external-tasks.ts
- apps/web/src/server/repositories/mcp-tokens.ts
- apps/web/src/server/repositories/projects.ts
- apps/web/src/server/repositories/versions.ts
- apps/web/src/server/services/company-workspace.ts
- apps/web/src/server/services/comparison-cache.ts
- apps/web/src/server/services/dev-test-accounts.ts
- apps/web/src/server/services/handoff-lifecycle.ts
- apps/web/src/server/services/handoff-review-access.ts
- apps/web/src/server/services/handoff-sharing-data.ts
- apps/web/src/server/services/members.ts
- apps/web/src/server/services/mentions.ts
- apps/web/src/server/services/notification-preferences.ts
- apps/web/src/server/services/onboarding.ts
- apps/web/src/server/services/project-icons.ts
- apps/web/src/server/services/review-visibility.ts
- apps/web/src/server/services/slack.ts
- apps/web/src/server/services/superadmins.ts
- apps/web/src/server/services/viewer-pins.ts
- apps/web/src/server/storage/snapshot-store.ts
- apps/web/src/server/workspace-access.ts

Also convert scripts/seed-sample-projects.mjs, which imports the database directly.

## Appendix B: Current tests that import better-sqlite3

Replace these fixtures with Postgres-backed fixtures or focused PostgreSQL integration tests:

- apps/web/app/api/mcp/route.test.mjs
- apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/sharing/route.test.mjs
- apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/icon/route.test.mjs
- apps/web/src/server/migrations/handoff-sharing.test.mjs
- apps/web/src/server/migrations/legacy-task-mcp-cleanup.test.mjs
- apps/web/src/server/migrations/shared-assets.test.mjs
- apps/web/src/server/migrations/version-immutability.test.mjs
- apps/web/src/server/repositories/changelogs.test.mjs
- apps/web/src/server/repositories/findings.test.mjs
- apps/web/src/server/repositories/handoff-lifecycle.test.mjs
- apps/web/src/server/repositories/handoff-sharing-data.test.mjs
- apps/web/src/server/repositories/node-replacements.test.mjs
- apps/web/src/server/services/comparison-cache.test.mjs
- apps/web/src/server/services/dev-test-accounts.test.mjs
- apps/web/src/server/services/handoff-review-access.test.mjs
- apps/web/src/server/services/mcp-access.test.mjs
- apps/web/src/server/services/members.test.mjs
- apps/web/src/server/services/mentions.test.mjs
- apps/web/src/server/services/onboarding.test.mjs
- apps/web/src/server/services/slack.test.mjs
- apps/web/src/server/services/superadmins.test.mjs
- apps/web/src/server/services/viewer-pins.test.mjs
- apps/web/src/server/services/viewer-updates.test.mjs
- apps/web/src/server/storage/snapshot-store.test.mjs
- apps/web/src/server/workspace-access.test.mjs

## References

- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- [Supabase serverless database drivers](https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers)
- [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Better Auth PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql)

