# Vercel and Supabase deployment

The app now uses Supabase Postgres and private Supabase Storage. Better Auth and the existing Google sign-in flow remain in place. Large Figma captures and browser uploads go directly to Storage so their file bytes do not pass through a Vercel Function.

This repository change prepares the app and migration tools. It does not link or deploy a Vercel project, create a hosted Supabase project, or copy production data. Complete those steps against a staging project before production cutover.

## Vercel project settings

Use these settings for the web app:

| Setting | Value |
| --- | --- |
| Root directory | `apps/web` |
| Framework | Next.js |
| Install command | `npm install` |
| Build command | `npm run build` |
| Output directory | Leave the framework default |
| Include files outside the root directory | Enabled, so the build can read `packages/snapshot-contract` |

The tracked root lockfile is `package-lock.json`, and the root package declares npm workspaces. Keep using npm for Vercel builds. The untracked local `pnpm-lock.yaml` is not part of the Git checkout and is not used by this deployment.

The web app imports the shared `@asbir/snapshot-contract` workspace package. `transpilePackages` includes that package in the Next.js build.[^workspace]

Set the Vercel Function region close to the Supabase database region. Vercel supports a project-wide region setting in the dashboard or a `regions` setting in `vercel.json`.[^regions]

Vercel limits Function request and response bodies to 4.5 MB. The Figma plugin and browser package-import flow therefore send large bytes directly to Supabase Storage.[^limits]

### Memory, duration and build

Large captures are parsed and compressed in memory, so the defaults are too small for real files:

| Setting | Value | Why |
| --- | --- | --- |
| Plan | Pro | Hobby caps Functions at 2 GB and limits duration |
| Function memory | 4 GB (Settings → Functions → Advanced) | Saving or comparing a ~250 MB capture peaks at 2-3 GB |
| `maxDuration` | 300 s, set in the capture, compare, findings, changelog, remove-screens, package-finalize and MCP routes and on the handoff and review pages | Raise to 800 in those files if large captures time out on Pro |
| `DATABASE_URL` at build | Available to the Build step, not only at runtime | `auth.ts` creates the database client when the module loads, so `next build` fails without it |

Optional: `ASBIR_SNAPSHOT_CACHE_MB` sets how much parsed capture data a Function instance keeps in memory between requests. The default is 160 MB on Vercel and 1024 MB elsewhere. A capture bigger than the budget is never cached. Raise it only together with Function memory.

## Environment variables

Set these server-side variables for Preview and Production. Use separate Supabase projects for the two environments.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase Postgres transaction-pooler connection string |
| `SUPABASE_URL` | Supabase project API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Storage access; never use a `NEXT_PUBLIC_` name |
| `SUPABASE_STORAGE_BUCKET` | Private bucket name; use `handoff-assets` |
| `SUPABASE_STORAGE_URL` | Optional Storage origin override; normally leave blank |
| `BETTER_AUTH_URL` | Public app origin for this environment |
| `BETTER_AUTH_SECRET` | Unique high-entropy secret for this environment |
| `ASBIR_AUTH_BYPASS` | Set to `0` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ASBIR_ALLOWED_EMAIL_DOMAINS` | Comma-separated allowed sign-in domains |
| `ASBIR_COMPANY_NAME` | Name shown when creating the first workspace |
| `ASBIR_MCP_ALLOWED_ORIGINS` | Optional comma-separated MCP client origins |
| `SLACK_BOT_TOKEN` | Optional Slack notifications |
| `OPENAI_API_KEY` | Optional AI changelog drafts |
| `OPENAI_MODEL` | Optional model override |

Copy the database connection string from Supabase’s Transaction pooler settings. Do not use the database password or service-role key in browser code. Add the deployed app origin and `<BETTER_AUTH_URL>/api/auth/callback/google` to the Google OAuth client.

## Create and update the Supabase schema

The default local app uses file-backed PGlite and a local object store. Start it with `npm run dev`; it does not need Docker or Supabase credentials. To run against the Supabase CLI stack instead, use:

```sh
npx supabase start
npx supabase db reset
npm run setup:env
npm run dev:supabase
```

Set the local `SUPABASE_SERVICE_ROLE_KEY` in `apps/web/.env.local` using the local key printed by `supabase status`. The example file contains the local Postgres and API URLs. Keep `.env.local` private.

Apply versioned migrations to a linked hosted project with:

```sh
npx supabase link --project-ref <staging-project-ref>
npx supabase db push
```

Link the Production project separately and push the same reviewed migrations after staging verification. Do not run schema DDL during app startup.

Migration `20261118010000_chunked_snapshots.sql` adds per-screen copies of each capture, so inspecting one screen does not load the whole capture. The app works without it (it falls back to the whole capture) but is much slower on large files, so apply it before inviting testers.

### Storage limits

On the Supabase Free plan a single file is capped at 50 MB, which large Figma captures exceed. Use Supabase Pro and set both the project's global upload limit (Settings → Storage) and the `handoff-assets` bucket file size limit to at least 256 MB.

## Migrate existing data

Keep the old SQLite database and object directory read-only and backed up until verification and the rollback window finish. First run the importer in dry-run mode with explicit source paths:

```sh
node scripts/migrate-sqlite-to-supabase.mjs \
  --sqlite /path/to/asbir-handoff.sqlite \
  --objects /path/to/objects \
  --checkpoint /path/to/asbir-migration-checkpoint.json
```

After reviewing the dry-run report and confirming the target is a disposable staging project, import with `--apply` and the same source paths and checkpoint. The apply command requires `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. The script does not load `.env.local` automatically.

Run the verifier with the same SQLite and object paths after import:

```sh
node scripts/verify-supabase-migration.mjs \
  --sqlite /path/to/asbir-handoff.sqlite \
  --objects /path/to/objects
```

The verifier compares row counts, references, object metadata, and SHA-256 checksums. It reads but does not modify the SQLite source.

## Figma plugin and Storage

Build the plugin for each deployment with the app URL and Supabase URL:

```sh
HANDOFF_PUBLIC_URL=https://<app-host> \
SUPABASE_URL=https://<project-ref>.supabase.co \
npm run build --workspace @asbir/figma-plugin
```

If the project uses a custom Storage origin, set `SUPABASE_STORAGE_URL` to that same origin when building the plugin. The generated manifest allows the capture routes and the configured Storage origin. The plugin contains no Supabase key. Configure Storage CORS to allow the Figma plugin origin and the signed upload, signed download, and TUS methods and headers. See the [Figma plugin guide](figma-plugin.md) for upload behavior and the [Figma capture guide](figma-capture.md) for limits and retry details.

Keep the `handoff-assets` bucket private. App asset routes and MCP tools authorize access before issuing short-lived signed download URLs. Large MCP renders return a temporary URL instead of an inline response.

## Alternate Docker or Railway hosting

Docker and Railway can host the app server while using the same Supabase Postgres database and Storage bucket. They do not need a local data volume or Litestream. Set the same server-side variables in `deployment.env.example`; keep the old `asbir_data` volume untouched until you have backed up and verified its contents.

See [deploy/README.md](../deploy/README.md) for the self-hosting steps.

## Production cutover and rollback

1. Apply the reviewed migrations to a dedicated staging project.
2. Import sanitized or production-copy data into staging and run the verifier.
3. Deploy a Vercel Preview connected only to staging.
4. Verify sign-in, authorization, handoff reads, comments, package import, Figma capture, private assets, MCP tools, and persistence across separate function invocations.
5. Before cutover, back up the live SQLite database and copy its object directory. Freeze writes, run the final import, run the verifier, then deploy Production against the production Supabase project.
6. With testers, capture a large real file (several hundred screens) from the plugin built for this deployment. Confirm the new-version notice appears in an open handoff tab, screens open quickly, and removed screens stay removed.
7. Keep the old deployment and backup read-only through the rollback window. If cutover fails before new writes, restore the old deployment and resume writes there. If users have written to Supabase, preserve those writes before rolling back.

## Current verification status

The app starts locally against PGlite, and its health and workspace routes return successfully. The Supabase baseline and app schema pass PGlite tests, and the migration scripts pass fixture tests. The local Supabase CLI stack could not be started in this environment, and no hosted Supabase or Vercel credentials were available. A hosted Storage upload, Vercel Preview, OAuth callback, and production data migration still need staging verification.

[^limits]: [Vercel Function limits](https://vercel.com/docs/functions/limitations).
[^regions]: [Configuring regions for Vercel Functions](https://vercel.com/docs/functions/configuring-functions/region).
[^workspace]: [Vercel monorepos](https://vercel.com/docs/monorepos) and [Next.js `transpilePackages`](https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages).
