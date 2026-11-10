# Asbir Handoff

Asbir Handoff is a standalone web app for sharing versioned design snapshots with product, engineering, and QA teams.

## Requirements

- Node.js `22.23.1`
- npm `10`

## Start the web app

```sh
npm install
npm run setup:env
npm run dev
```

`npm run setup:env` creates `apps/web/.env.local` with a unique local authentication secret. For self-hosting, set `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and `ASBIR_DATA_DIR` on a server with persistent disk. Add `OPENAI_API_KEY` and optionally `OPENAI_MODEL` to enable AI changelog drafts. The default model is `gpt-6-astra`.

Run the unit and integration suites with `npm test`.

## Self-host for your team

The Docker Compose setup runs the app behind Caddy, which provides HTTPS for a public domain. Point the domain at the server and allow inbound TCP ports 80 and 443 before starting the stack.

1. Copy `deployment.env.example` to `.env`.
2. Set `ASBIR_DOMAIN` and create a unique secret with `openssl rand -base64 32`. Put the result in `BETTER_AUTH_SECRET`.
3. Add `OPENAI_API_KEY` if you want server-generated changelog drafts.
4. Start the app with `docker compose up -d --build`.
5. Open `https://<your-domain>` and create the workspace owner account.

The `asbir_data` volume stores the SQLite database and captured design assets. This stack runs one app instance because it uses local SQLite storage. Caddy stores its TLS certificates in `caddy_data`. `docker compose down` keeps these named volumes. Do not add `--volumes` unless you intend to delete the team's handoffs and certificates. Rebuild an updated app with `docker compose up -d --build`.

If an MCP client sends an `Origin` header, set `ASBIR_MCP_ALLOWED_ORIGINS` in `.env` to a comma-separated list of trusted origins before starting the stack. Keep `.env` private; it contains the authentication secret and may contain the AI API key.

## Install as a desktop app

Deploy Asbir Handoff over HTTPS, then choose **Install app** from the app or the install option in Chrome or Microsoft Edge. On macOS Sonoma 14 or later, Safari users can choose **File → Add to Dock**. The installed app opens in its own window and accesses the same workspace data. Depending on the browser, you might need to sign in again in the installed app.

The app needs a network connection when installed. Its service worker passes requests through to the server and does not cache screens or handoff data for offline use.

For local flow testing, set `ASBIR_AUTH_BYPASS=1` in `apps/web/.env.local` to skip sign-in and use the first local account. The bypass only runs in development and remains disabled in production.

The app stores its SQLite database and uploaded assets under `ASBIR_DATA_DIR` (defaults to `apps/web/data`). Keep that directory on persistent storage when you deploy the app.

AI changelog drafting sends version differences, layout findings, and relevant team comments to the OpenAI API. Requests set `store: false`. Do not include sensitive information in comments unless your team is allowed to send it to the configured AI provider.

Workspace owners can create MCP tokens from **Workspace → Integrations**. Configure an MCP client with the workspace-specific URL shown there and send the token as a bearer credential. The URL includes a workspace ID, which Asbir Handoff checks against the token. The token secret is shown once, stored as a hash, scoped to one workspace, and expires within one year. If an MCP client sends an `Origin` header, set `ASBIR_MCP_ALLOWED_ORIGINS` to a comma-separated list of trusted origins. See [the agent MCP setup guide](docs/agents/mcp-setup.md) for Codex and generic client snippets.

Connect Asbir Handoff to the AI client your team already uses. That client can connect to its own Asbir Teams, ClickUp, Linear, repository, and QA tools alongside Handoff, then use the handoff evidence to create tasks or do implementation work. The `tasks:write` scope lets the client record an external task in Asbir Handoff with its version, screen, and optional element reference. Handoff does not need credentials for the client's other MCP tools.

The Next.js app lives in `apps/web`. Shared handoff data contracts and source integrations live in separate npm workspaces.

## Import a Figma canvas

Build and import the Figma plugin using the [Figma capture setup guide](docs/figma-plugin.md). For local development, the build defaults to `http://localhost:3000`. For a hosted handoff, set `HANDOFF_PUBLIC_URL` to its HTTPS origin before building so the plugin can reach that server.

In Asbir Handoff, open a project and create a Figma capture session. The app shows a one-time token that expires after one hour, giving large captures time to finish before upload. Open the plugin, confirm its Handoff server, paste the token, and choose selected artboards, the current page, or the entire Figma file across all pages. Review its overview image and upload the frozen version.

The plugin stores the canvas overview, a PNG for each captured artboard, layer geometry, Figma auto-layout padding and gaps, paint details, style references, and only variables that are bound to captured layers. Figma does not define CSS margins, so Handoff labels distances measured from the immediate parent bounds as measured margins. See [the snapshot package and Figma capture guide](docs/figma-capture.md) for the import format and source limits. Direct Paper MCP capture is deferred; structured package upload remains source-agnostic.

Owners and designers can publish a canvas, choose its sharing mode, invite external email addresses, and remove versions or handoffs. See [handoff sharing and lifecycle behavior](docs/handoff-sharing.md) for access rules, invite links, and deletion behavior.

## Vercel status

The `asbir-handoff` project exists in the LMF Asbir Tech Vercel team, but it is not connected to GitHub and has not been deployed. The current database and image store use local disk, so review the [Vercel deployment handoff](docs/vercel-deployment.md) before enabling a deployment.
