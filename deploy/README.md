# Deploying Asbir Handoff

One Node server, with the database and images on a persistent volume at `/var/lib/asbir-handoff`.
For a single server with HTTPS, the repo's `compose.yaml` + `Caddyfile` (see the main README) is the simplest path. Run exactly one
instance: SQLite can't be shared between servers.

## Requirements

| | |
|---|---|
| Runtime | Node 22 (in the Docker image) |
| Memory | 4 GB recommended (2 GB is enough only for small captures). Building needs ~1.6 GB. |
| Disk | A volume at `/var/lib/asbir-handoff`, 5 GB to start. Today: ~7 MB database + ~172 MB images. |
| Requests | Capture uploads can reach ~400 MB in one request and take minutes: proxies must allow that. |
| HTTPS | Required (sign-in cookies, Google OAuth, the installable app). |

## Environment

Copy `apps/web/.env.example` and fill it in. In production, always:

- `BETTER_AUTH_URL=https://<your-domain>` and a fresh `BETTER_AUTH_SECRET` (`openssl rand -base64 32`)
- `ASBIR_AUTH_BYPASS=0`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, with `https://<your-domain>` and
  `https://<your-domain>/api/auth/callback/google` added to the Google OAuth client
- `ASBIR_DATA_DIR=/var/lib/asbir-handoff` (already set in the image)

Optional: `SLACK_BOT_TOKEN`, `OPENAI_API_KEY`, `ASBIR_COMPANY_NAME`.

## Railway

1. New project → Deploy from GitHub repo. `railway.json` makes it build the `Dockerfile` and check `/api/health`.
2. Add a **Volume** mounted at `/var/lib/asbir-handoff`.
3. Add the environment variables above, and `ASBIR_BUILD_ID` = `${{RAILWAY_GIT_COMMIT_SHA}}` so open apps offer a reload after each deploy.
4. Pick a plan with at least 4 GB of memory for large captures.

## Any Docker host

```bash
docker build --build-arg ASBIR_BUILD_ID=$(git rev-parse --short HEAD) -t asbir-handoff .
docker run -d -p 3000:3000 -v asbir-data:/var/lib/asbir-handoff --env-file .env.production --restart unless-stopped asbir-handoff
```

Put HTTPS in front (Caddy, Cloudflare, your platform's proxy) with request size and timeout limits
raised for capture uploads.

## Backups

- **Database:** set `LITESTREAM_REPLICA_URL` (for example `s3://bucket/asbir-handoff`) plus
  `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`, and `LITESTREAM_ENDPOINT` for R2 or B2.
  Changes stream to the bucket every few seconds. A fresh volume restores the latest copy on start.
- **Images** (`/var/lib/asbir-handoff/objects`): Litestream only covers the database. Use your host's volume
  snapshots, or a scheduled `rclone sync /var/lib/asbir-handoff/objects <bucket>/objects`. Image files never change
  once written (names come from their content), so syncing is cheap.
- Never copy the `.sqlite` file of a running app by hand; use Litestream or `sqlite3 db ".backup file"`.

## Checks after deploying

- `GET /api/health` returns `{"ok":true}`.
- Sign in with Google, open a handoff, and run one Figma capture to the new URL.
