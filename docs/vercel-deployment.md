# Vercel deployment handoff

## Current status

The `asbir-handoff` project was created in the `LMF Asbir Tech` Vercel team. It has not been connected to the GitHub repository or deployed. The team can resume deployment work after selecting and implementing durable database and image storage.

## Why storage must change first

The web app currently uses `better-sqlite3` and stores its database under `ASBIR_DATA_DIR`. Captured renders and image assets use the local object store under the same directory. This works on the persistent disk used by the Docker Compose setup, but Vercel Functions do not provide a persistent application filesystem. A deployment must not rely on these local files for handoff data.

Vercel recommends external object storage for files written by Functions. Vercel Storage offers Blob for files and Marketplace integrations for managed databases. See [Vercel's storage overview](https://vercel.com/docs/storage), [Vercel Blob](https://vercel.com/docs/vercel-blob), and [Vercel's filesystem guidance](https://vercel.com/kb/guide/why-does-my-serverless-function-work-locally-but-not-when-deployed).

## Work required before the first deployment

1. Select a managed PostgreSQL provider from the Vercel Marketplace, such as Neon or Supabase.
2. Replace the synchronous SQLite database access with an asynchronous PostgreSQL data layer. Convert schema migrations and repository queries, and configure Better Auth to use PostgreSQL.
3. Replace `LocalObjectStore` with a private object-storage implementation. Vercel Blob private storage or a private S3-compatible bucket are options. Keep all reads behind Asbir Handoff's workspace authorization checks.
4. Add a migration utility to copy the existing SQLite rows and captured files into the selected stores. Preserve each asset key and immutable version reference.
5. Configure production environment variables in Vercel, including `BETTER_AUTH_URL`, a new `BETTER_AUTH_SECRET`, database credentials, object-storage credentials, and optional OpenAI settings.
6. Connect the GitHub repository, configure the Next.js monorepo build, and deploy a preview first.
7. Verify sign-in, capture upload, version switching, comments, image reads, and data persistence across separate requests before promoting a production deployment.

The existing Docker Compose setup remains the working deployment path while this migration is pending. Its named volume persists the SQLite database and image files on a single host.

## Preserve before migrating

Do not delete the self-hosted `asbir_data` volume during the migration. Make a database backup and copy its corresponding asset directory before running a migration. Verify the imported versions and images before switching users to Vercel.
