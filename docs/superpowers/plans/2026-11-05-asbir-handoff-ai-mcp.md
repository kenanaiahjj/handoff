# Asbir Handoff AI, MCP, and task workflows implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate evidence-linked changelogs and QA notes, expose handoff data and actions through MCP, connect task MCP servers, and make the snapshot available to coding agents.

**Architecture:** AI receives deterministic Handoff diffs and layout findings and returns editable drafts with evidence references. Handoff exposes a workspace-scoped remote MCP server; workspace admins can connect a task MCP server, and external coding agents can use Handoff plus repository tools from their MCP host.

**Tech Stack:** TypeScript, Next.js Route Handlers, OpenAI JavaScript SDK with Responses API, MCP TypeScript SDK v2 server and client packages, Zod 4.

## Global Constraints

- AI summaries must cite existing frame, node, diff, measurement, comment, or rule IDs.
- AI may not infer exact measurements, token bindings, or node matches.
- OpenAI credentials remain server-side in environment configuration; the application shows setup status when no key is available.
- Handoff MCP access is scoped to authenticated workspace membership and an explicit MCP token.
- Outbound task MCP connections are configured by a workspace owner and store secrets encrypted at rest.
- Agents use their own repository MCP permissions for code changes; Handoff does not execute arbitrary code.
- Use `npm run lint` and `npm run build` for implementation checks. Do not add or run automated tests unless the user asks.

## File map

- `apps/web/src/server/ai/provider.ts` — AI request and response types.
- `apps/web/src/server/ai/openai-provider.ts` — OpenAI Responses API adapter.
- `apps/web/src/server/ai/draft-changelog.ts` — evidence payload and draft persistence.
- `apps/web/src/server/mcp/handoff-server.ts` — authorized Handoff tools.
- `apps/web/src/app/api/mcp/route.ts` — remote Streamable HTTP MCP endpoint.
- `apps/web/src/server/mcp/connections.ts` — outbound task MCP connection registry.
- `apps/web/src/server/mcp/task-tools.ts` — discover and invoke configured task tools.
- `apps/web/src/app/(workspace)/settings/integrations/` — AI and MCP connection screens.
- `apps/web/src/app/(workspace)/projects/[projectId]/handoffs/[handoffId]/` — changelog and task review UI.

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

- [ ] Add `openai` to `@asbir/web`; read `OPENAI_API_KEY` and `OPENAI_MODEL` on the server only.
- [ ] Implement `AiProvider.generateChangelog(input)` with an OpenAI Responses API adapter. Return a setup error if either environment variable is absent.
- [ ] Build the model input from structured diffs, layout findings, token changes, and comments. Include evidence IDs and source values; omit image-only measurements.
- [ ] Require structured JSON output validated by `changelogDraftSchema`. Reject any evidence reference not found in the supplied input.
- [ ] Save drafts with author, source version IDs, created time, status `draft`, and model identifier.
- [ ] Add editable product, developer, and QA sections. Every statement displays links to its supporting frames/nodes/findings.
- [ ] Run `npm run lint --workspace @asbir/web` and `npm run build --workspace @asbir/web`; manually generate and edit a draft from a two-version fixture with known changes.

## Task 2: Expose scoped Handoff MCP tools

**Files:** Create `src/server/mcp/handoff-server.ts`, `src/server/mcp/token-auth.ts`, and `src/app/api/mcp/route.ts`.

**Interfaces:**

```ts
export interface HandoffMcpContext {
  workspaceId: string;
  userId: string;
  scopes: Array<"handoffs:read" | "comments:write" | "tasks:write">;
}
```

- [ ] Add an owner-only page to create and revoke MCP tokens. Store a hash, workspace ID, member ID, scope list, and expiration; show the secret only once.
- [ ] Use `@modelcontextprotocol/server` v2 and `createMcpHandler` from the official SDK to serve `POST /api/mcp` with Node runtime.
- [ ] Construct a fresh MCP server per request from authenticated request context; never share a mutable server instance across workspaces.
- [ ] Add read tools `list_projects`, `list_handoffs`, `get_snapshot`, `get_frame`, `get_version_diff`, `get_measurements`, `get_token_bindings`, `list_comments`, and `list_findings`.
- [ ] Add write tools `create_comment`, `draft_changelog`, and `create_task` only when the token includes the matching scope.
- [ ] Validate every tool input with Zod and return a clear error for missing IDs, inaccessible workspaces, unavailable measurement data, or missing evidence.
- [ ] Add a connection guide with the remote MCP URL and per-agent setup snippets that use a token supplied by the workspace member.
- [ ] Run `npm run lint --workspace @asbir/web` and `npm run build --workspace @asbir/web`; manually connect a local MCP client and retrieve one authorized version and one denied version from a different workspace.

## Task 3: Connect task MCP servers

**Files:** Create `src/server/mcp/connections.ts`, `task-tools.ts`, MCP connection tables, and integration settings pages.

- [ ] Add an owner-only form for an HTTPS remote MCP endpoint, display name, auth type, bearer/OAuth secret, and permitted actions. Reject credentials embedded in URLs.
- [ ] Encrypt connection secrets with AES-256-GCM using `ASBIR_ENCRYPTION_KEY`; keep the key outside SQLite and require 32 bytes.
- [ ] Use `@modelcontextprotocol/client` v2 over Streamable HTTP to discover available tools. Store server metadata and tool names/schema, not returned user data.
- [ ] Allow an owner to select a task creation tool and map Handoff fields to that tool's declared schema.
- [ ] Before invoking the tool, show the exact task title, description, evidence links, destination, and mapped fields. Create only after the user chooses `Create task` or an authorized MCP caller invokes `create_task`.
- [ ] Persist the external task ID and URL with the originating handoff, version, and evidence refs. Handle timeouts and remote errors without storing a false success state.
- [ ] Require HTTPS in production. Reject loopback, link-local, and private-network destinations unless the owner explicitly configures a trusted internal endpoint in a self-hosted deployment.
- [ ] Run `npm run lint --workspace @asbir/web` and `npm run build --workspace @asbir/web`; manually connect a development MCP task server, map its create tool, and create a task linked to a Handoff frame.

## Task 4: Support coding-agent handoff

**Files:** Add agent handoff panel, MCP onboarding, and docs under `docs/agents/`.

- [ ] Add a `Start with agent` panel that selects a handoff version, related task, and allowed Handoff MCP scopes.
- [ ] Generate agent context containing the accepted snapshot URL, version diff, exact measurements, token bindings, comments, approved changelog, and task acceptance criteria.
- [ ] Provide Codex and generic MCP configuration snippets with the workspace-specific remote MCP URL and scoped token placeholder; never include a live secret in a copied project link.
- [ ] Explain that repository edits are performed by the connected agent under its repository permissions and that the Handoff version remains immutable.
- [ ] Store agent run links or repository pull request URLs on the task/handoff record when users return them.
- [ ] Run web `npm run lint` and `npm run build`, then manually connect an MCP client alongside a repository MCP and verify the agent can fetch the source evidence needed for one task.

## Completion check

This plan is complete when an AI draft is editable and evidence-linked, a workspace-scoped MCP client can inspect a handoff, a configured task MCP can create a linked task, and an external coding agent can retrieve the handoff context with its repository tools.
