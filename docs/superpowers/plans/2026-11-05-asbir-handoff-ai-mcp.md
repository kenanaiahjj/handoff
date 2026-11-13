# Asbir Handoff AI, MCP, and external task workflows implementation plan

**Execution note:** Keep implementation inline. Use checkbox (`- [ ]`) steps to track remaining work.

**Goal:** Generate evidence-linked changelogs and QA notes, expose handoff data and actions through MCP, link tasks created by the team's AI client, and make frozen snapshots available to coding agents.

**Architecture:** AI receives deterministic Handoff diffs and layout findings and returns editable drafts with evidence references. Handoff exposes a workspace-scoped remote MCP server. The AI client's host connects to Handoff alongside its own task-tracker, repository, and QA MCP tools. The client creates external tasks or code changes; Handoff stores task references and exact design evidence. Handoff does not connect to external MCP servers, store their credentials, or execute code.

**Tech Stack:** TypeScript, Next.js Route Handlers, OpenAI JavaScript SDK with Responses API, MCP TypeScript SDK v2 server, and Zod 4.

## Global Constraints

- AI summaries must cite existing frame, node, diff, measurement, comment, or rule IDs.
- AI may not infer exact measurements, token bindings, or node matches.
- OpenAI credentials remain server-side in environment configuration; the application shows setup status when no key is available.
- Handoff MCP access is scoped to authenticated workspace membership and an explicit MCP token.
- Task-tracker, repository, and QA MCP connections belong to the user's AI client. Handoff stores no credentials for those tools.
- The `tasks:write` MCP scope records a task created elsewhere; it does not create tasks in an external system.
- Agents use their own repository MCP permissions for code changes; Handoff does not execute arbitrary code.
- Use `npm run lint` and `npm run build` for implementation checks. Do not add or run automated tests unless the user asks.

## File map

- `apps/web/src/server/ai/schema.ts` — AI request and response schemas.
- `apps/web/src/server/ai/openai-provider.ts` — OpenAI Responses API adapter.
- `apps/web/src/server/ai/draft-changelog.ts` — evidence payload and draft persistence.
- `apps/web/app/api/mcp/route.ts` — workspace-scoped remote MCP endpoint.
- `apps/web/src/server/services/task-context.ts` and `link-external-task.ts` — validate task references and attach exact snapshot evidence.
- `apps/web/src/server/repositories/linked-external-tasks.ts` — store task links and returned agent or pull request URLs.
- `apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/tasks/route.ts` — list and link external tasks.
- `apps/web/src/components/canvas/AgentHandoffPanel.tsx` and `LinkedTasksPanel.tsx` — review and agent task-link UI.

## Task 1: Add evidence-linked AI drafts

**Files:** Create the AI provider, prompt builder, output schema, repository, and changelog panel.

**Interfaces:**

```ts
export interface EvidenceRef {
  versionId: string;
  frameId: string;
  sourceNodeId: string | null;
  diffId: string | null;
  findingId: string | null;
}

export interface DraftStatement {
  text: string;
  audience: "product" | "developer" | "qa";
  evidence: EvidenceRef[];
}

export interface ChangelogDraft {
  handoffId: string;
  fromVersionId: string;
  toVersionId: string;
  statements: DraftStatement[];
}
```

- [x] Add `openai` to `@asbir/web`; read `OPENAI_API_KEY` and optional `OPENAI_MODEL` on the server only.
- [x] Implement `AiProvider.generateChangelog(input)` with an OpenAI Responses API adapter. Return a setup error if the API key is absent and use the configured model or server default.
- [x] Build the model input from structured diffs, layout findings, token changes, and comments. Include evidence IDs and source values; omit image-only measurements.
- [x] Require structured JSON output validated by `changelogDraftSchema`. Reject any evidence reference not found in the supplied input.
- [x] Save drafts with author, source version IDs, created time, status `draft`, and model identifier.
- [x] Add editable product, developer, and QA sections. Every statement links to its supporting frame or element.
- [x] Show approved notes in the published canvas and link each citation to its source version, screen, or element. Keep unapproved drafts out of non-designer responses.
- [x] Run `npm run lint --workspace @asbir/web` and `npm run build --workspace @asbir/web`.
- [x] Connect Codex to the isolated Handoff MCP endpoint and generate a product, developer, and QA draft from a known two-version fixture. Verify that the saved draft cites only evidence returned for that version pair. Verified 2026-11-12; draft remains unapproved and isolated from user workspaces.
- [ ] Manually generate and edit a draft from a two-version fixture with known changes.

## Task 2: Expose scoped Handoff MCP tools

**Files:** `apps/web/app/api/mcp/route.ts`, workspace MCP token APIs and UI, and `docs/agents/mcp-setup.md`.

**Interfaces:**

```ts
export interface HandoffMcpContext {
  workspaceId: string;
  userId: string;
  scopes: Array<"handoffs:read" | "comments:write" | "changelog:write" | "tasks:write">;
}
```

- [x] Add a workspace integrations page to create and revoke scoped MCP tokens. Store a hash, workspace ID, member ID, scope list, and expiration; show the secret only once.
- [x] Use `@modelcontextprotocol/server` v2 and `createMcpHandler` from the official SDK to serve `POST /api/mcp` with Node runtime.
- [x] Construct a fresh MCP server per request from authenticated request context; never share a mutable server instance across workspaces.
- [x] Add read tools `list_projects`, `list_handoffs`, `list_versions`, `list_frames`, `get_snapshot`, `get_canvas_overview`, `get_frame`, `get_version_diff`, `get_measurements`, `get_token_bindings`, `list_comments`, `list_linked_tasks`, and `list_findings`. `list_frames` provides a compact inventory so agents can select screens without fetching the full payload.
- [x] Add write tools `create_comment`, `draft_changelog`, `save_changelog_draft`, and `link_task` only when the token includes the matching scope. `draft_changelog` uses the optional server provider; `save_changelog_draft` accepts the connected AI client's authored content and validates evidence IDs without a server AI key. `link_task` records an external task; it never calls the external tracker.
- [x] Add `get_changelog_evidence` so connected AI clients can retrieve the exact version-pair evidence IDs before drafting.
- [x] Validate every tool input with Zod and return a clear error for missing IDs, inaccessible workspaces, unavailable measurement data, or missing evidence.
- [x] Add a connection guide with the workspace-specific remote MCP URL and per-agent setup snippets that use a token supplied by the workspace member.
- [x] Run `npm run lint --workspace @asbir/web` and `npm run build --workspace @asbir/web`.
- [x] Exercise the remote MCP JSON-RPC endpoint with a temporary read-only token: initialize a client, enumerate the then-current 13 read tools, retrieve an authorized snapshot and exact measurement fields, and confirm a mismatched workspace URL returns HTTP 403. Baseline verified 2026-11-07; the temporary token was removed afterward.
- [x] Compare all four adjacent version pairs in the local fixture through `get_version_diff`. The route returned changed and removed frame records plus visual/structural changes. Verified 2026-11-07.
- [x] Exercise `POST /api/mcp` with an in-memory workspace token: verify cross-workspace handoff denial, workspace URL mismatch returns HTTP 403, and an external task reference round-trips through `link_task` and `list_linked_tasks` with its exact version and evidence hash.
- [x] Exercise `get_changelog_evidence` and `save_changelog_draft` with a synthetic two-version fixture: verify added-screen evidence is attached to the exact version pair and fabricated evidence IDs are rejected without inserting a draft.
- [x] Bound large MCP reads: `get_snapshot` summarizes payloads over 1 MiB, `get_frame` summarizes large layer trees, `list_elements` returns 100 captured elements per page, and token bindings and version diffs expose page metadata.
- [x] Stress-test 1,200 changed elements through the MCP diff route and confirm 100-item pages stay below 250 KiB while Figma-native fractional measurements remain unchanged.
- [x] Run a live local Streamable HTTP smoke with an isolated read-only fixture on 2026-11-12: initialize protocol `2025-11-25`, discover all 16 read tools while write tools remain hidden, retrieve exact fractional layout, spacing, and token values, and confirm a mismatched workspace returns HTTP 403.
- [x] Connect the Codex CLI to the isolated read-only MCP endpoint and retrieve exact fractional measurements, spacing, and token bindings. Verified 2026-11-12 with a `handoffs:read` token and automatic approval in the temporary test environment.
- [x] Run a disposable multi-MCP Codex workflow with local Asbir Teams, repository, and QA servers alongside a two-version Handoff fixture. Codex matched the captured width and padding, updated a temporary source file, passed QA, created a mock task, and linked it to Version 2 with exact screen, element, revision, and geometry evidence. Verified 2026-11-12; no external service or user workspace was changed.
- [ ] Connect an AI client to the actual Asbir Teams task tool, repository MCP, and QA MCP. Create an external task, link it through Handoff, and retrieve the exact version link with `list_linked_tasks`. The local mock multi-MCP workflow passed; actual external services remain unverified.

## Task 3: Link tasks created through the AI client's own tools

**Files:** `task-context.ts`, `link-external-task.ts`, `linked-external-tasks.ts`, the handoff tasks API route, the Handoff MCP route, the agent panel, and `0008_external_task_links.sql`.

- [x] Validate an external task ID or URL and preserve its source system, title, and notes.
- [x] Validate optional screen and element IDs against the selected immutable snapshot version.
- [x] Expose `link_task` under `tasks:write` and `list_linked_tasks` under `handoffs:read`.
- [x] Store the version label, source revision, content hash, screen or element properties, and a deep link to the exact canvas location.
- [x] Link a task from the review UI and attach returned agent-run or pull-request URLs.
- [x] Migrate existing task links into the external-link table before dropping legacy task MCP connections and credentials.
- [x] Add a follow-up migration that removes the obsolete task-MCP connection and task-link tables after preserving their external references.
- [x] Run a Codex round-trip with isolated local task, repository, and QA MCP servers: update the temporary source from Handoff measurements, pass QA, create a mock Asbir Teams task, then call `link_task` and `list_linked_tasks` with exact Version 2 evidence. Verified 2026-11-12; no real task or repository changed.
- [ ] Repeat the task round-trip with the actual Asbir Teams MCP and team repository/QA MCP servers. No external task was created during local testing.

## Task 4: Support coding-agent handoff

**Files:** Add agent handoff panel, MCP onboarding, and docs under `docs/agents/`.

- [x] Add a `Start with agent` panel that selects a handoff version, related task, and allowed Handoff MCP scopes.
- [x] Generate agent context containing the accepted snapshot URL, version diff, exact measurements, token bindings, comments, approved changelog, and task acceptance criteria.
- [x] Provide Codex and generic MCP configuration snippets with the workspace-specific remote MCP URL and scoped token placeholder; never include a live secret in a copied project link.
- [x] Explain that repository edits are performed by the connected agent under its repository permissions and that the Handoff version remains immutable.
- [x] Store agent run links or repository pull request URLs on the task/handoff record when users return them.
- [x] Run web `npm run lint` and `npm run build`.
- [x] Connect Codex alongside isolated repository and QA MCPs; verify it reads the Handoff diff and measurements, edits the temporary code, and receives a passing QA result before linking the mock task. Verified 2026-11-12.
- [ ] Verify the agent workflow against the team's actual repository and QA MCP endpoints.

## Completion check

This plan is complete when an AI draft is editable and evidence-linked, a workspace-scoped MCP client can inspect a handoff, an externally created task can be linked to exact snapshot evidence, and an AI client can use its own task, repository, and QA tools alongside Handoff. Handoff must not store credentials for those tools or execute code.
