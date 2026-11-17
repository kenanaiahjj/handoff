# Asbir Handoff

Asbir Handoff is a standalone web app for sharing versioned design snapshots with product, engineering, and QA teams.

## Requirements

- Node.js `22.23.1`
- npm `10`

## Start the web app

```sh
npm install
npm run dev
```

`npm run dev` starts the app with a persistent local PostgreSQL-compatible database, local file storage, sample workspace and project, and the development sign-in bypass. It does not require Docker or Supabase credentials. The local database and files live under `data/`.

To use a local Supabase stack instead, start its services and run the app against them:

```sh
npx supabase start
npx supabase db reset
npm run setup:env
npm run dev:supabase
```

Add `OPENAI_API_KEY` and optionally `OPENAI_MODEL` to enable AI changelog drafts. The default model is `gpt-6-astra`.

Run the unit and integration suites with `npm test`.

## Self-host for your team

The Docker Compose setup runs the app behind Caddy, which provides HTTPS for a public domain. The app uses Supabase Postgres and Storage, including when Docker or Railway hosts the app server. Point the domain at the server and allow inbound TCP ports 80 and 443 before starting the stack.

1. Apply the Supabase schema and copy its transaction-pooler URL, project URL, and service-role key.
2. Copy `deployment.env.example` to `.env` and set the Supabase values, `ASBIR_DOMAIN`, Google OAuth credentials, and a unique `BETTER_AUTH_SECRET` from `openssl rand -base64 32`.
3. Set `ASBIR_AUTH_BYPASS=0`. Add `OPENAI_API_KEY` if you want server-generated changelog drafts.
4. Start the app with `docker compose up -d --build`.
5. Open `https://<your-domain>` and sign in with Google. The first person to sign in becomes the owner and an admin.

The app no longer stores handoff data on a local volume. Keep any old `asbir_data` volume untouched until you have backed it up and verified the Supabase import. Caddy stores its TLS certificates in `caddy_data`; `docker compose down` keeps that volume. Rebuild an updated app with `docker compose up -d --build`.

If an MCP client sends an `Origin` header, set `ASBIR_MCP_ALLOWED_ORIGINS` in `.env` to a comma-separated list of trusted origins before starting the stack. Keep `.env` private; it contains the authentication secret and may contain the AI API key.

## Install as a desktop app

Deploy Asbir Handoff over HTTPS, then choose **Install app** from the app or the install option in Chrome or Microsoft Edge. On macOS Sonoma 14 or later, Safari users can choose **File → Add to Dock**. The installed app opens in its own window and accesses the same workspace data. Depending on the browser, you might need to sign in again in the installed app.

The app needs a network connection when installed. Its service worker keeps screen images and per-screen details on the device so handoffs reopen quickly, and clears them on sign-out; pages and sign-in always go to the server.

For local flow testing, set `ASBIR_AUTH_BYPASS=1` in `apps/web/.env.local` to skip sign-in and use the first local account. The bypass only runs in development and remains disabled in production.

The app stores relational data in Supabase Postgres and assets in its private Supabase Storage bucket. See [the Vercel and Supabase deployment guide](docs/vercel-deployment.md) for environment variables, staging verification, migration, and rollback steps.

AI changelog drafting sends version differences, layout findings, and relevant team comments to the OpenAI API. Requests set `store: false`. Do not include sensitive information in comments unless your team is allowed to send it to the configured AI provider.

Workspace owners can create MCP tokens from **Workspace → Integrations**. Configure an MCP client with the workspace-specific URL shown there and send the token as a bearer credential. The URL includes a workspace ID, which Asbir Handoff checks against the token. The token secret is shown once, stored as a hash, scoped to one workspace, and expires within one year. If an MCP client sends an `Origin` header, set `ASBIR_MCP_ALLOWED_ORIGINS` to a comma-separated list of trusted origins. See [the agent MCP setup guide](docs/agents/mcp-setup.md) for Codex and generic client snippets.

Connect Asbir Handoff to the AI client your team already uses. That client can connect to its own Asbir Teams, ClickUp, Linear, repository, and QA tools alongside Handoff, then use the handoff evidence to create tasks or do implementation work. The `tasks:write` scope lets the client record an external task in Asbir Handoff with its version, screen, and optional element reference. Handoff does not need credentials for the client's other MCP tools.

The Next.js app lives in `apps/web`. Shared handoff data contracts and source integrations live in separate npm workspaces.

## Import a Figma canvas

Build the plugin for the embedded local app with `npm run plugin:build:local`, then import its manifest using the [Figma capture setup guide](docs/figma-plugin.md). For local Supabase or a hosted handoff, set `HANDOFF_PUBLIC_URL`, `SUPABASE_URL`, and optionally `SUPABASE_STORAGE_URL` before building.

In Asbir Handoff, open a project and create a Figma capture session. The app shows a one-time token that expires after one hour, giving large captures time to finish before upload. Open the plugin, confirm its Handoff server, paste the token, and choose selected artboards, the current page, or the entire Figma file across all pages. Review its overview image and upload the frozen version.

The plugin stores the canvas overview, a PNG for each captured artboard, layer geometry, Figma auto-layout padding and gaps, paint details, style references, and only variables that are bound to captured layers. Figma does not define CSS margins, so Handoff labels distances measured from the immediate parent bounds as measured margins. See [the snapshot package and Figma capture guide](docs/figma-capture.md) for the import format and source limits. Direct Paper MCP capture is deferred; structured package upload remains source-agnostic.

Owners and designers can publish a canvas, choose its sharing mode, invite external email addresses, and remove versions or handoffs. See [handoff sharing and lifecycle behavior](docs/handoff-sharing.md) for access rules, invite links, and deletion behavior.

## Vercel status

The code is prepared for Vercel and Supabase, but this branch has not been connected or deployed. Hosted schema, Storage, OAuth, Preview, and data migration still need staging verification. Follow the [Vercel and Supabase deployment guide](docs/vercel-deployment.md).
