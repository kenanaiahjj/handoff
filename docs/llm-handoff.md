# Asbir Handoff: handoff for the next agent

Read this first. It tells you what the app is, how to run and verify it, the rules you must not
break, what was shipped recently, and a prioritized backlog with "done when" checks. Repo-specific
coding notes for Next.js also live in `apps/web/AGENTS.md` (Next 16 differs from older versions:
read `node_modules/next/dist/docs/` before using an API you are unsure of).

## 1. What the app is

Designers capture Figma files with a Figma plugin and publish them as **frozen, versioned
handoffs**. Developers, QA, PMs, marketing and executives review screens, inspect measurements,
compare versions, comment (with @mentions), and get notified of new versions.

- One company team, **Asbir Tech**. Under the hood there is exactly one `workspace` row; people
  only ever see **projects** (for example "Tripket Mobile App", "Maayo Ferries"). Never reintroduce
  workspace lists, switchers or "create workspace" in the UI.
- Sign-in: Google only for new accounts, limited to `ASBIR_ALLOWED_EMAIL_DOMAINS`
  (`lmf.ventures,plxrmedia.com`). Admins (the `superadmin` table) may use any domain.
- Roles (`workspace_membership.role`): `owner`, `designer` = managers (see everything, publish,
  manage). `reviewer`, `developer`, `qa` = viewers (see only handoffs shared with them).
- Onboarding: a new person picks Product designer, Developer, QA, Product manager, Marketing or
  Executive; that maps to a workspace role (`src/server/services/onboarding.ts`).

## 2. Repo map

| Path | What |
|---|---|
| `apps/web` | Next.js 16.4.5 app (App Router, React 19.3, `cacheComponents` on) |
| `apps/web/src/server` | Server code: `db.ts` (SQLite + migrations), `repositories/`, `services/`, `storage/`, `workspace-access.ts` (all access checks) |
| `apps/web/src/server/migrations` | SQL migrations, run in filename order on server start (`0001`…`0020`) |
| `apps/web/src/components` | UI. `canvas/` (handoff canvas, compare, phone view), `shell/` (homes, tabs, quick open, update notice), `comments/` (threads, mentions) |
| `packages/snapshot-contract` | Capture schema, validation, content fingerprint (`hashSnapshotPayload`), merge and screen removal |
| `integrations/figma-plugin` | The Figma capture plugin (separate build) |
| `scripts/` | Test loader, `seed-sample-projects.mjs` (dev sample data) |
| `deploy/`, `Dockerfile`, `compose.yaml`, `Caddyfile`, `railway.json` | Deployment (see `deploy/README.md`) |
| `docs/` | Feature docs (capture, plugin, sharing, snapshot package, Vercel notes) |

## 3. Run, test, verify

Node 22 (`.nvmrc`). From the repo root:

```bash
npm install
npm run setup:env            # creates apps/web/.env.local
npm run dev                  # http://localhost:3000
```

Tests (Node test runner; the bracketed route tests must be run file by file):

```bash
npm test -- $(find apps packages -name "*.test.mjs" -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*\[*")
find apps -name "*.test.mjs" -path "*\[*" -not -path "*/node_modules/*" | while read f; do node --experimental-transform-types --loader ./scripts/node-esm-loader.mjs "$f"; done
cd apps/web && npx tsc --noEmit -p . && npx eslint .
```

Baseline at handoff: **293 tests passing**, typecheck and lint clean. Keep it that way; never weaken a
test to make a change pass.

Local verification without real sign-in (development only):

- `ASBIR_AUTH_BYPASS=1` in `apps/web/.env.local` signs every request in as the first account.
- The sidebar's **View as · dev** switches between Owner and a seeded reviewer (Riley).
- **+ Fresh account (onboarding)** / "Use fresh account" on the sign-in page creates a throwaway
  `dev-test-*` account with sample handoffs shared, for testing onboarding. "Done testing" removes them.
- **Sign out** with the bypass on turns it off for that browser only (cookie `asbir_bypass_off`).
- Sample projects: `node --experimental-transform-types --loader ./scripts/node-esm-loader.mjs scripts/seed-sample-projects.mjs`.
- Check UI in a browser at desktop and phone width; don't call a UI change done from tests alone.

## 4. Rules you must not break

1. **Access control is enforced on the server for every route** via `src/server/workspace-access.ts`
   (`requireWorkspaceRole`, `requireHandoffAccess`, `requireProjectMember`) and
   `services/review-visibility.ts` (`visibleHandoffIds`). Viewers see only handoffs with an active
   invite to their email or in a project where they are PD. Hidden handoffs answer **404**, never 403.
   Images (`/api/assets/[key]`) follow the same rule. Any new route or query that returns handoff
   data must apply these checks; add a test that a reviewer is refused.
2. **Versions are immutable.** A DB trigger blocks updates to `handoff_version`; the only allowed
   change is replacing `snapshot_json` with `'{}'` once a verified compressed copy exists
   (migration `0020`). Don't add other exceptions.
3. **Capture accuracy.** Every capture's `content_hash` is recomputed on save and must match.
   Never store captures in a way that can change bytes (no Postgres `jsonb`). Stored captures are
   Brotli-compressed in `handoff_version_snapshot` (`src/server/storage/snapshot-store.ts`);
   always read them through `readSnapshotJson` / `getVersion`.
4. **Projects only in the UI.** Words like "workspace" must not appear on screen (say "team").
   Internal names and `/workspace/[id]/…` URLs are fine.
5. **Mentions** may only target people who can see the handoff (`listMentionables`).
6. **Dev-only features** (bypass, View as, fresh accounts, `/api/dev/*`) must stay unreachable in
   production: they are gated on `NODE_ENV=development` and `ASBIR_AUTH_BYPASS=1`.
7. Don't commit `apps/web/.env.local`, `apps/web/data/`, `.claude/`, `work/` or `pnpm-lock.yaml`
   (the repo uses npm).

## 5. What shipped recently (so you don't redo it)

- Server-side role enforcement on all API routes, with tests.
- Google sign-in with domain limits; premium sign-in and onboarding pages; super admins ("Admins").
- Projects-only UI; app-style reviewer home grouped by project, with pins, Mark as seen,
  "N screens changed" tiles that open the comparison, ⌘K quick open, and "Needs you" (open @mentions).
- Figma-style tabs for open handoffs (remembers the last screen per handoff, on the device).
- @mentions with autocomplete; Slack DMs for new versions and mentions (`services/slack.ts`,
  off until `SLACK_BOT_TOKEN` is set; tested only against a fake Slack API).
- Phone swipe view for handoffs (`components/canvas/MobileReview.tsx`).
- Device caching: immutable image headers with ETag/304, and a service worker that caches only
  images and per-screen details (`public/sw.js`). It must never intercept pages or sign-in: that
  once broke the Google sign-in return in the installed app.
- "A new version is available" notice (`components/shell/UpdateNotice.tsx`, `/api/app-version`).
- Comparison view: searchable screens list with an All / Changed filter.
- Compressed captures (database 480 MB → 7 MB), `/api/health`, Litestream backups, deploy kit.

## 6. Backlog (highest value first)

Each item: why, where to start, and when it is done.

### Done since this document was first written

- Member management (owners change roles and remove people; Members panel on the Projects page).
- Designer requests need an owner's approval (`user_profile.requested_role`, Approve / Decline in Members).
- Figma plugin network access covers all capture routes (`/api/capture-sessions/`), so a production
  build can call preview and baseline-overview as well as upload.
- Capture memory roughly halved: stored captures are read without a second full validation pass.
- Comparison results are saved (`comparison_cache`, keyed on the confirmed-match fingerprint):
  a repeat comparison takes milliseconds.
- Screen change counts use a design fingerprint (layers without names, canvas position, export
  pointers or sub-pixel noise) instead of image bytes: Tripket's rename release went from 199 to 1.

### P0: needed to go live

1. **Build and run the Docker image once.** It was written on a machine without Docker.
   Start: `docker compose up -d --build` with a filled `.env` (see `deployment.env.example`).
   Done when: the image builds, `/api/health` returns `{"ok":true}`, Google sign-in works on the
   real domain, a capture from the Figma plugin lands, and a restart keeps the data.
2. **Rebuild the Figma plugin for the real domain** once it is chosen:
   `HANDOFF_PUBLIC_URL=https://<domain> npm run build` in `integrations/figma-plugin`, then load
   `manifest.json` in Figma. Done when: a 200-screen capture uploads to production.

### P1: quality

3. **End-to-end tests** (Playwright) for: sign-in (bypass), onboarding, reviewer can't see unshared
   handoffs, comment with mention → Needs you, compare, phone view, member removal.
4. **Error tracking and logs** (for example Sentry) on the server and client. Needs an account.
5. **Further memory cut** if 200+ screen files become common: store per-screen node data separately
   and load it on demand (the canvas already fetches node details per screen).

### P2: reviewer and designer experience

10. **Slack**: per-person notification settings (all / mentions only / off) and a daily digest
    option; verify against a real Slack workspace.
11. **In-app notifications** (bell) mirroring Slack, for people who don't use Slack.
12. **Phone view**: show and add comments, and start in "Changed only" when opened from a change tile.
13. **Mentions in public review links** (`/review/[shareId]`) for signed-in members.
14. **Tidy URLs**: `/workspace/<id>/projects/<id>/handoffs/<id>` could become
    `/p/<project>/<handoff>`; keep redirects from old links.
15. **Large-team scale**: paginate the reviewer home and project lists.

### Only if required by company policy

16. **Port to Vercel + Supabase.** See `docs/vercel-deployment.md`. About 170 synchronous SQLite
    queries become async Postgres, migrations are converted, captures move to Storage as files,
    and the Figma plugin must upload straight to Storage (Vercel caps requests at 4.5 MB). For this
    team the single server is as fast or faster; the port buys scaling and stack familiarity.
    Done when: every existing version's fingerprint matches after migration, all tests pass
    against Postgres, and a real capture uploads end to end.

## 7. Traps hit before (save yourself the time)

- **Next 16 + `cacheComponents`**: don't use `export const dynamic`; call `await connection()` to
  make a route or page request-time. Route handlers that don't read the request can be prerendered.
- **React compiler lint**: hooks after an early return fail lint; functions used in effects defined
  later should be read through a ref.
- **Dev hot reload can leave a window with stale CSS**, especially the installed app. The update
  notice detects it; production can't hit this.
- **Tests build their own small SQLite schemas.** If you add a table that core reads join on
  (as `handoff_version_snapshot` was), add it to those test schemas too.
- **Brackets in route test paths** stop `node --test` globbing; run those files directly.
- **Migrations run on server start**, and the dev server restarts itself when server files change,
  so a new migration can apply to your local DB as soon as you save. Back up `apps/web/data` first
  when a migration rewrites data.
- **A `Dockerfile`, `compose.yaml` and `Caddyfile` already exist.** Edit them, don't replace them.
  The data folder in containers is `/var/lib/asbir-handoff`.

## 8. Key facts and numbers

- Production idle memory: ~131 MB. One 200-screen capture loaded: ~950 MB; two: ~1.5 GB. Plan 4 GB RAM.
- Database ~7 MB, images ~172 MB (local dev data). A large capture adds ~1–2 MB compressed.
- Capture upload limits: 128 MB snapshot JSON and 256 MB of assets per request.
- Deployment spec for the dev team: see `deploy/README.md`.
