# Asbir Handoff implementation roadmap

**Approved design:** [Asbir Handoff design](../specs/2026-11-05-asbir-handoff-design.md)

The design has several independently deliverable subsystems, so implementation is split into five plans. Each plan leaves a working product slice and uses the same snapshot contract.

| Order | Plan | Deliverable | Depends on |
|---|---|---|---|
| 1 | [Platform and snapshot core](2026-11-05-asbir-handoff-platform.md) | Team web app, auth, persistent snapshots, structured package upload | None |
| 2 | [Review and layout QA](2026-11-05-asbir-handoff-review.md) | Canvas, comments, version diffs, exact inspection, rules, exports | Platform and snapshot core |
| 3 | [Figma capture](2026-11-05-asbir-handoff-figma.md) | Source-side Figma plugin that creates structured handoffs | Platform and snapshot core |
| 4 | [Paper capture](2026-11-05-asbir-handoff-paper.md) | Paper Desktop MCP bridge that creates structured handoffs | Platform and snapshot core |
| 5 | [AI, MCP, and task workflows](2026-11-05-asbir-handoff-ai-mcp.md) | Evidence-linked drafts, remote Handoff MCP, links to externally created tasks, agent handoff | Platform and review core |

## Execution order

Build the platform and snapshot contract first. The review plan can then proceed while the Figma and Paper adapters are built independently against that contract. Complete the AI and MCP plan after the review service exposes stable version diffs and layout findings.

Do not mark the product complete after the first plan. The final acceptance criteria remain the full list in the approved design, including real capture from both source applications and the designer-to-review-to-task-to-agent workflow.

## Shared technical decisions

- Use Node.js 22 and npm workspaces. The current environment has Node 22.23.1 and npm 10.9.8; Node 22 is an LTS line. [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- Use Next.js App Router with TypeScript for the hosted web app. Next.js currently requires Node.js 20.9 or newer and supports modern browsers. [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- Use Better Auth 1.7.17 with SQLite for the first single-instance hosted deployment. Keep the database and asset directory on a persistent volume; the current environment does not have Docker installed. Better Auth documents SQLite support with `better-sqlite3`. [Better Auth installation](https://better-auth.com/docs/installation)
- Use the official MCP TypeScript SDK v2 packages for MCP server and client work. The current SDK documentation describes v2 as the stable line and includes HTTP and stdio transports. [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- Use OpenAI's official JavaScript SDK and Responses API for the first AI provider. Read `OPENAI_API_KEY` and `OPENAI_MODEL` from server configuration. [OpenAI JavaScript quickstart](https://developers.openai.com/api/docs/quickstart) [Responses API migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- Use a shared Zod 4 snapshot contract across the web app and capture tools. Preserve source payloads and attach provenance to every exact or derived measurement.
- Never call geometry exact when the input is image-only. Never infer token bindings from matching raw colors or values.
- Keep Rust out of the first implementation. Use browser canvas and Web Workers for visual diffing.
- Do not put secrets, SQLite databases, or uploaded design assets in Git.

## Coverage map

| Approved design requirement | Plan |
|---|---|
| Team workspaces, roles, immutable version records, snapshot package upload | Platform and snapshot core |
| Canvas, comments, exports, version comparison, exact measurements, configurable checks | Review and layout QA |
| Figma full-canvas/frame capture, node tree, padding, gaps, bound tokens | Figma capture |
| Paper Desktop/MCP capture with the same normalized geometry and token data | Paper capture |
| AI changelog, developer notes, QA scenarios, MCP tools, external task links, agent workflow | AI, MCP, and task workflows |
