# Deploying Asbir Handoff

Vercel is the primary app host. Docker and Railway can host the same Next.js app with Supabase as the shared database and object store. The app no longer requires a writable local volume.

## Requirements

| | |
|---|---|
| Runtime | Node.js 22 |
| Database | Supabase Postgres transaction pooler |
| Asset store | Private Supabase Storage bucket named `handoff-assets` |
| Public URL | HTTPS, required for Better Auth cookies and Google OAuth |

## Environment

Copy `deployment.env.example` to `.env` for Docker Compose. Set:

- `ASBIR_DOMAIN` and a unique `BETTER_AUTH_SECRET`
- `DATABASE_URL` to the Supabase transaction-pooler connection string
- `SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET=handoff-assets`
- Google OAuth credentials and the allowed company email domains
- `ASBIR_AUTH_BYPASS=0`

Add `OPENAI_API_KEY` or `SLACK_BOT_TOKEN` only when you use those integrations. Keep `.env` private. Never prefix the service-role key with `NEXT_PUBLIC_`.

## Railway

1. Deploy the repository with the included `Dockerfile`.
2. Set the environment variables above in Railway. Use the same Supabase project for the app and Storage.
3. Set `BETTER_AUTH_URL` to the public Railway domain and update the Google OAuth callback to `<BETTER_AUTH_URL>/api/auth/callback/google`.
4. Confirm Railway health checks call `/api/health`.

Do not attach a persistent volume for application data. Keep any old `asbir_data` volume read-only until you have backed it up and verified its import into Supabase.

## Docker Compose

Copy the environment template, fill it in, then run:

```sh
cp deployment.env.example .env
docker compose up -d --build
```

Caddy provides HTTPS for `ASBIR_DOMAIN` and stores its certificates in the `caddy_data` volume. The app reads relational data from Postgres and assets from private Storage. `docker compose down` preserves Caddy's named volumes.

## Backups and rollback

Configure database and Storage backups for the Supabase project. Before production cutover, keep a verified copy of the existing SQLite database and object directory. Do not delete the old `asbir_data` volume until the rollback window ends.

Use `scripts/migrate-sqlite-to-supabase.mjs` to import the old data and `scripts/verify-supabase-migration.mjs` to compare rows, references, sizes, and checksums. Follow [the Vercel and Supabase deployment guide](../docs/vercel-deployment.md) for the complete staging and rollback process.

## Checks after deploying

- `GET /api/health` returns `{"ok":true}` when Postgres is available.
- Sign in with Google and open an existing handoff.
- Upload a Figma capture and a structured ZIP package.
- Open protected assets as a workspace member and a published reviewer.
- Restart or redeploy the app and confirm handoffs and assets remain available.
