# Asbir Handoff platform and snapshot core implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the hosted team app foundation, authenticated workspaces, a versioned snapshot store, and structured snapshot-package upload.

**Architecture:** Use a small npm workspace with a Next.js App Router web app and a shared snapshot-contract package. Store relational metadata and auth data in SQLite, image assets in a local object directory, and keep both under a configurable persistent data directory.

**Tech Stack:** Node.js 22, npm 10, Next.js App Router, TypeScript, Zod 4, Better Auth 1.7.17, `better-sqlite3`, browser `fetch`, Node `crypto`.

## Global Constraints

- Preserve the snapshot schema version, source IDs, frame hierarchy, source payload, dimensions, layout properties, colors, typography, and token bindings.
- Persist each accepted handoff version immutably with a SHA-256 content hash.
- Treat image-only imports as visual-only; do not report exact padding, margins, or token identity from pixels.
- Scope every read and write by authenticated workspace membership.
- Store database files and uploaded assets under `ASBIR_DATA_DIR`; do not commit them.
- Use Node 22.23.1 and npm 10.9.8 available in the current environment.
- Use `npm run lint` and `npm run build` as implementation checks. Do not add or run automated tests unless the user asks for them.

## File map

- `package.json` — npm workspace root scripts and workspace list.
- `.nvmrc` — Node version used by the workspace.
- `.gitignore` — excludes dependency, build, runtime database, and upload directories.
- `apps/web/` — Next.js UI, route handlers, auth, repositories, and file storage.
- `packages/snapshot-contract/` — versioned Zod schema and TypeScript types shared by the app and source adapters.
- `apps/web/src/server/db.ts` — one SQLite connection and schema migrations.
- `apps/web/src/server/repositories/` — workspace, handoff, version, and asset persistence.
- `apps/web/src/server/storage/` — local asset storage interface and implementation.
- `apps/web/src/server/auth.ts` — Better Auth instance and workspace access helpers.

## Task 1: Scaffold the web workspace

**Files:** Create root package configuration and the Next.js app in `apps/web/`.

**Interfaces:** The web app is `@asbir/web`; shared packages use the `@asbir/*` namespace.

- [ ] Create `apps/web/` with `npm create next-app@latest apps/web -- --yes --skip-install` so the workspace installs dependencies once from the root.
- [ ] Create the root `package.json` with `private: true`, workspaces `apps/*`, `packages/*`, and `integrations/*`, and scripts `dev`, `build`, and `lint` that delegate to `@asbir/web`.
- [ ] Set the app package name to `@asbir/web` and add the workspace dependency `@asbir/snapshot-contract` when Task 2 creates it.
- [ ] Write `.nvmrc` with `22.23.1` and `.gitignore` with `node_modules/`, `.next/`, `data/`, `.env*`, and `!.env.example`.
- [ ] Add `.DS_Store` to `.gitignore` so Finder metadata is never staged.
- [ ] Run `npm install` from the project root so npm creates one root lockfile for all workspaces.
- [ ] Run `npm run dev --workspace @asbir/web` and confirm the app responds at `http://localhost:3000`.

## Task 2: Define the shared snapshot contract

**Files:** Create `packages/snapshot-contract/package.json`, `src/types.ts`, `src/schema.ts`, `src/hash.ts`, and `src/index.ts`.

**Interfaces:**

```ts
export type SnapshotSource = "figma" | "paper" | "bundle";
export type MeasurementProvenance = "source" | "measured" | "unavailable";

export interface Measurement {
  value: number | null;
  unit: "px";
  provenance: MeasurementProvenance;
  sourceProperty: string | null;
}

export interface SnapshotNode {
  sourceNodeId: string;
  parentSourceNodeId: string | null;
  name: string;
  type: string;
  bounds: { x: number; y: number; width: number; height: number };
  padding: { top: Measurement; right: Measurement; bottom: Measurement; left: Measurement };
  margins: { top: Measurement; right: Measurement; bottom: Measurement; left: Measurement };
  spacing: { rowGap: Measurement; columnGap: Measurement; itemGap: Measurement };
  fills: Array<{ color: string | null; opacity: number | null; sourceStyleId: string | null }>;
  typography: {
    fontFamily: string | null;
    fontSize: number | null;
    fontWeight: string | number | null;
    lineHeight: number | null;
    letterSpacing: number | null;
    textAlign: string | null;
    content: string | null;
  } | null;
  tokens: Array<{ sourceId: string; name: string; mode: string | null; value: unknown }>;
  sourcePayload: Record<string, unknown>;
}
```

- [ ] Add `zod@4` to the package and export `snapshotEnvelopeSchema`, `snapshotFrameSchema`, and `snapshotNodeSchema`.
- [ ] Define `SnapshotEnvelope` with `schemaVersion: 1`, source file and revision IDs, capture timestamp, content hash, overview asset key, frames, assets, and raw source metadata.
- [ ] Define frame, token, style, typography, spacing, margin, and asset fields from the approved design. Every numeric measurement carries its unit, provenance, and source property.
- [ ] Make unknown source fields survive parsing in `sourcePayload`; reject invalid required fields and unsupported schema versions.
- [ ] Implement `hashSnapshotPayload(payload)` with Node SHA-256 over canonical JSON that excludes `contentHash` itself.
- [ ] Export all public types and validators from `src/index.ts` and add `@asbir/snapshot-contract` as a workspace dependency of the web app.
- [ ] Run `npm run lint --workspace @asbir/web` and `npm run build --workspace @asbir/web` after imports compile.

## Task 3: Add auth, workspace membership, and SQLite persistence

**Files:** Create `apps/web/src/server/db.ts`, `auth.ts`, `workspace-access.ts`, `migrations/0001_handoff.sql`, `src/app/api/auth/[...all]/route.ts`, and `src/app/(auth)/sign-in/page.tsx`.

**Interfaces:**

```ts
export async function requireWorkspaceRole(
  request: Request,
  workspaceId: string,
  allowedRoles: Array<"owner" | "designer" | "reviewer" | "developer" | "qa">
): Promise<{ userId: string; workspaceId: string; role: string }>;
```

- [ ] Add `better-auth@1.7.17` and `better-sqlite3` to `@asbir/web`.
- [ ] Create the SQLite connection at `${ASBIR_DATA_DIR}/asbir-handoff.sqlite` and create the directory before opening the database.
- [ ] Configure Better Auth with the SQLite connection, email/password sign-in, `BETTER_AUTH_URL`, and a required high-entropy `BETTER_AUTH_SECRET`.
- [ ] Mount Better Auth handlers at `/api/auth/*` using `toNextJsHandler(auth)`.
- [ ] Generate Better Auth's SQLite tables with `npx auth@latest generate` from `apps/web/`, then include the generated SQL in the first migration.
- [ ] Add `workspace`, `workspace_membership`, and `workspace_invite` tables. Membership roles are `owner`, `designer`, `reviewer`, `developer`, and `qa`; invite tokens are stored hashed and expire.
- [ ] Implement `requireWorkspaceRole` so missing sessions return 401, non-members return 404, and insufficient roles return 403.
- [ ] Add a sign-in page and a protected workspace home page. The owner can create a copyable invitation link; SMTP delivery is outside this plan.
- [ ] Run `npm run lint --workspace @asbir/web` and `npm run build --workspace @asbir/web`.

## Task 4: Persist projects, snapshots, and assets

**Files:** Create `migrations/0002_snapshots.sql`, `src/server/repositories/projects.ts`, `handoffs.ts`, `versions.ts`, `src/server/storage/object-store.ts`, and `local-object-store.ts`.

**Interfaces:**

```ts
export interface ObjectStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export async function createHandoffVersion(input: {
  workspaceId: string;
  projectId: string;
  createdBy: string;
  snapshot: SnapshotEnvelope;
}): Promise<{ handoffId: string; versionId: string }>;
```

- [ ] Add `project`, `handoff`, `handoff_version`, and `handoff_asset` tables with foreign keys and workspace indexes.
- [ ] Store version metadata and structured snapshot JSON in SQLite. Store image and binary assets in `${ASBIR_DATA_DIR}/objects/` under random opaque keys.
- [ ] Implement `LocalObjectStore` with path normalization that rejects `..`, absolute paths, and keys outside the object directory.
- [ ] Implement `createHandoffVersion` as one database transaction. Validate the snapshot, compute its hash, insert a new immutable version, and never update an existing version row.
- [ ] Require `source: "bundle"` for package imports and preserve the original package manifest in `sourcePayload`.
- [ ] Add repository methods to list projects, list versions, load a version, and stream a private asset after workspace authorization.
- [ ] Run `npm run lint --workspace @asbir/web` and `npm run build --workspace @asbir/web`.

## Task 5: Accept structured and image-only uploads

**Files:** Create `src/app/api/workspaces/[workspaceId]/projects/route.ts`, `src/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/route.ts`, `src/app/api/assets/[assetKey]/route.ts`, `src/server/services/import-snapshot.ts`, and upload pages under `src/app/(workspace)/`.

- [ ] Add a project creation form and a snapshot upload form with project, version label, and optional release note fields.
- [ ] Add `fflate` to `@asbir/web` and accept `.zip` structured packages with `manifest.json`, `overview.png`, frame image files, and `snapshot.json`; reject path traversal, duplicate asset keys, unsupported schema versions, and payloads larger than 100 MB.
- [ ] Accept PNG/JPEG image-only uploads as a visual-only snapshot with no geometry or token fields. Mark the resulting version `visualOnly: true` and expose that flag in version metadata.
- [ ] Validate every structured package with `snapshotEnvelopeSchema` before writing any asset or database record.
- [ ] Write uploaded files through `ObjectStore`, create the version, and remove newly written assets if the database transaction fails.
- [ ] Scope project and upload routes using `requireWorkspaceRole`; designers and owners can create, reviewers can read.
- [ ] Run `npm run lint --workspace @asbir/web` and `npm run build --workspace @asbir/web`, then manually create a workspace, project, structured version, and visual-only version in the browser.

## Completion check

This plan is complete when the authenticated app persists workspace-scoped immutable versions, validates structured packages, serves private assets, and labels image-only imports as visual-only. Figma and Paper capture are completed by their separate plans.
