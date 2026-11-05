# Asbir Handoff Paper capture implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a product designer start a Paper handoff and preserve frame renders, HTML/CSS layout values, token bindings, source IDs, and dimensions in the shared snapshot format.

**Architecture:** A local Paper bridge connects to the Paper Desktop MCP server on the designer's machine, discovers its available read tools, maps supported results into the shared snapshot contract, and uploads the capture through a short-lived Handoff capture token. A structured package upload remains the fallback when a supported Paper tool is unavailable.

**Tech Stack:** Node.js 22, TypeScript, `@modelcontextprotocol/client` v2, shared Zod snapshot contract, Paper Desktop CLI/MCP, `fetch`.

## Global Constraints

- Paper capture must be initiated by the designer from the source file.
- Preserve the complete source structure and exact CSS/layout/token values in the normalized snapshot and raw source payload.
- The Paper Desktop MCP is local to the user's Paper Desktop session; the hosted Handoff server never attempts to reach the designer's localhost.
- Do not claim full Paper fidelity until a real Paper file has passed the capture review in this plan.
- If the discovered Paper MCP tool output lacks required fields, offer structured package upload and report the precise missing fields; do not fabricate them.
- Use `npm run lint` and `npm run build` for implementation checks. Do not add or run automated tests unless the user asks.

## File map

- `integrations/paper-bridge/package.json` — bridge dependencies and commands.
- `integrations/paper-bridge/src/cli.ts` — user-facing `capture` and `inspect-tools` commands.
- `integrations/paper-bridge/src/mcp-client.ts` — local Paper MCP client and transport.
- `integrations/paper-bridge/src/tool-discovery.ts` — tool list, schemas, and configurable mappings.
- `integrations/paper-bridge/src/normalize-paper.ts` — Paper response to shared snapshot mapping.
- `integrations/paper-bridge/src/upload.ts` — Handoff capture-session upload.
- `integrations/paper-bridge/src/config.ts` — local config and credential loading.
- `docs/paper-capture.md` — setup and troubleshooting.

## Task 1: Discover and document the Paper MCP contract

**Files:** Create `integrations/paper-bridge/package.json`, `src/cli.ts`, `src/mcp-client.ts`, and `src/tool-discovery.ts`.

**Interfaces:**

```ts
export interface PaperToolInventory {
  serverInfo: { name: string; version: string };
  tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
}

export async function inspectPaperTools(): Promise<PaperToolInventory>;
```

- [ ] Accept the Paper Desktop CLI command path from `PAPER_MCP_COMMAND`; do not shell-concatenate user input.
- [ ] Connect to the local Paper MCP server with `StdioClientTransport` from the official MCP TypeScript client.
- [ ] Call the MCP list-tools operation and print the server identity, tool names, descriptions, and input schemas as JSON.
- [ ] Call the documented `get_basic_info` tool when present and confirm the currently open Paper file before capture.
- [ ] Add `inspect-tools` output to `docs/paper-capture.md` as a redacted example after a real Paper Desktop connection is available.
- [ ] Run `npm run lint` and `npm run build` in `integrations/paper-bridge`.

## Task 2: Map Paper frame data into the common snapshot

**Files:** Create `src/normalize-paper.ts` and `src/config.ts`.

- [ ] Define `PaperCaptureToolMap` with tool names and argument builders for current file info, selected-frame structure, frame image export, and token data.
- [ ] Populate the tool map from the discovered tool inventory, then store it in a user-local config file under the OS config directory. Do not store credentials in that file.
- [ ] Require the designer to select the frame or page in Paper before capture when the Paper tool contract uses selection context.
- [ ] Convert Paper frame and element IDs, parent relationships, bounds, rendered images, CSS dimensions, padding, margins, flex/grid gaps, colors, typography, and token bindings into `SnapshotEnvelope`.
- [ ] Store original tool outputs under each node's `sourcePayload` so Handoff can show the precise Paper property names.
- [ ] For values read from computed CSS or layout rules, use `provenance: "source"` and record the exact CSS property. For distances calculated from bounds, use `provenance: "measured"`.
- [ ] If a required field is absent, return `CaptureCapabilityError` with `missingFields: string[]` and a route to export/upload a structured package.
- [ ] Parse the normalized result with `snapshotEnvelopeSchema` before any upload.

## Task 3: Upload the Paper snapshot from the designer's machine

**Files:** Create `src/upload.ts` and finish `src/cli.ts`.

**Interfaces:**

```ts
export async function submitPaperCapture(input: {
  handoffBaseUrl: string;
  captureToken: string;
  snapshot: SnapshotEnvelope;
  assets: Array<{ key: string; contentType: string; bytes: Uint8Array }>;
}): Promise<{ handoffId: string; versionId: string; reviewUrl: string }>;
```

- [ ] Accept `--handoff-url` and a single-use `--capture-token` without logging either secret.
- [ ] Upload the normalized snapshot and assets to the capture API using HTTPS outside local development.
- [ ] Print the review URL and version ID after success.
- [ ] Preserve the normalized capture in a local retry bundle when the network upload fails; encrypt or omit the one-time token from the bundle.
- [ ] Add a `package` command that writes `manifest.json`, `snapshot.json`, `overview.png`, frame images, and other assets to a `.zip` file for manual upload.
- [ ] Run `npm run lint` and `npm run build` in `integrations/paper-bridge`.

## Task 4: Prove exact capture with a real Paper file

**Files:** Update the Paper tool map, normalizer, and `docs/paper-capture.md` from observed Paper output.

- [ ] Capture one real Paper file containing nested frames, explicit padding and margins, flex/grid spacing, bound tokens, unbound values, text, and an image asset.
- [ ] Compare each normalized number and token binding with the value shown in Paper's inspector or source output.
- [ ] Capture a second revision that changes padding, a margin, a token binding, and frame content; confirm the version payload preserves both revisions.
- [ ] Correct the mapping for every observed property mismatch. The bridge may not mark a field exact until the comparison matches the source value and unit.
- [ ] Record tested Paper app version, MCP server version, required tool names, and capture limitations in `docs/paper-capture.md`.
- [ ] Run `npm run lint` and `npm run build` in the bridge and web app, then verify the resulting version in the Handoff review screen.

## Completion check

This plan is complete only when a real Paper capture produces source-verified geometry, padding, margins or measured distances, colors, and token bindings in an immutable Handoff version. The fallback package path does not by itself prove direct Paper capture.
