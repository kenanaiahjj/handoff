# Handoff Management and Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owner/designer handoff and version deletion, new-tab handoff links, and per-handoff workspace, invite-only, and public sharing.

**Architecture:** Store the sharing mode and reusable per-email invite tokens on the handoff. Resolve review access in a server-only helper used by the published page and read endpoints. Keep anonymous access read-only and limited to the published version set; keep role enforcement scoped to destructive and sharing mutations.

**Tech Stack:** Next.js 16 App Router route handlers, React 19, Better Auth sessions, SQLite through `better-sqlite3`, Node test runner.

## Global Constraints

- Preserve existing uncommitted user changes and edit only files listed in this plan plus the new specification.
- Do not change the global relaxed role behavior in `workspace-access.ts`.
- Owners and designers are the only roles that can delete handoffs or versions or change sharing settings.
- Anonymous links open without sign-in and remain read-only.
- Invites are per-recipient bearer links with a role label. Viewing and comments need no sign-in; the invite email and role label are not verified. Owners copy and deliver the links manually.
- Shared object files are deleted only when no surviving version references them.
- Keep the authenticated handoff route separate from the published canvas route.

---

### Task 1: Define review-access policy and database schema

**Files:**
- Create: `apps/web/src/server/services/handoff-sharing.ts`
- Create: `apps/web/src/server/services/handoff-sharing.test.mjs`
- Create: `apps/web/src/server/migrations/0012_handoff_sharing.sql`
- Create: `apps/web/src/server/migrations/handoff-sharing.test.mjs`

**Interfaces:**
- `resolveHandoffReviewAccess(input)` returns `{ allowed, mode, canWrite, reason }` for workspace, invited, and anyone modes.
- `normalizeInviteEmail(email)` returns a trimmed lowercase email address.
- `hashHandoffInviteToken(token)` returns a SHA-256 hex digest.

- [ ] **Step 1: Write failing policy tests**

Test `workspace` access requires membership, `invited` access requires an active token and allows comments without sign-in, expired/revoked/mismatched tokens are denied, and `anyone` access is allowed without a session but read-only.

- [ ] **Step 2: Run the policy tests and confirm the expected failures**

Run: `node --test apps/web/src/server/services/handoff-sharing.test.mjs`

Expected: tests fail because the policy module does not exist.

- [ ] **Step 3: Add the migration and policy functions**

Add `handoff.sharing_mode TEXT NOT NULL DEFAULT 'workspace'` with a check for `workspace`, `invited`, and `anyone`. Add `handoff_invite` with workspace/handoff foreign keys, normalized email, unique token hash, expiry, revocation, creator, and creation time. Add indexes for handoff lookup and token lookup.

- [ ] **Step 4: Test the migration and policy**

Run: `node --test apps/web/src/server/services/handoff-sharing.test.mjs apps/web/src/server/migrations/handoff-sharing.test.mjs`

Expected: all policy and migration constraints pass, including handoff deletion cascading invites.

---

### Task 2: Add deletion, invite, and sharing repositories and routes

**Files:**
- Modify: `apps/web/src/server/workspace-access.ts`
- Create: `apps/web/src/server/services/workspace-role-policy.ts`
- Modify: `apps/web/src/server/repositories/handoffs.ts`
- Modify: `apps/web/src/server/repositories/versions.ts`
- Create: `apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/route.ts`
- Create: `apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/versions/[versionId]/route.ts`
- Create: `apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/sharing/route.ts`
- Create: `apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/invites/route.ts`
- Create: `apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/invites/[inviteId]/route.ts`
- Test: `apps/web/src/server/repositories/handoff-lifecycle.test.mjs`

**Interfaces:**
- `requireWorkspaceRoleStrict(request, workspaceId, allowedRoles)` enforces the supplied role list and leaves `requireWorkspaceRole` unchanged.
- `deleteHandoff({ workspaceId, projectId, handoffId })` removes the handoff and returns object keys that have no remaining asset references.
- `deleteHandoffVersion({ workspaceId, projectId, handoffId, versionId })` removes one version and returns the latest remaining version id and unreferenced object keys.
- Handoff routes use `DELETE`; version routes use `DELETE`; sharing routes use `GET` and `PATCH`; invite routes use `GET` and `POST`; invite-id routes use `DELETE`.

- [ ] **Step 1: Write failing lifecycle and authorization tests**

Test that deleting one of two versions preserves a shared object key and the second version; deleting the final reference returns that object key for cleanup; deleting a published version clears its published pointer; deleting a handoff cascades invitations and versions; only owner/designer passes the strict role predicate.

- [ ] **Step 2: Run the lifecycle tests and confirm the expected failures**

Run: `node --test apps/web/src/server/repositories/handoff-lifecycle.test.mjs`

Expected: tests fail because deletion and strict authorization functions do not exist.

- [ ] **Step 3: Implement repository deletes and strict role checks**

Delete database rows in an immediate transaction, collect asset keys before cascading, and query references after deletion inside the same transaction. Delete only unreferenced files after commit. Validate reusable asset source versions again inside version creation's insertion transaction so a concurrent delete cannot create a broken asset reference.

- [ ] **Step 4: Add strict mutation routes**

Return `401` for no session, `403` for a signed-in non-owner/designer, `404` for a resource outside the supplied workspace/project, and `200` with the remaining latest version id after successful deletion. Validate sharing modes, invite email format, expiry values, invite ownership, and revoked status before mutating.

- [ ] **Step 5: Run the lifecycle, migration, and policy tests**

Run: `node --test apps/web/src/server/repositories/handoff-lifecycle.test.mjs apps/web/src/server/migrations/handoff-sharing.test.mjs apps/web/src/server/services/handoff-sharing.test.mjs`

Expected: all focused tests pass.

---

### Task 3: Enforce sharing on review pages and read endpoints

**Files:**
- Modify: `apps/web/src/server/repositories/handoffs.ts`
- Modify: `apps/web/app/review/[shareId]/page.tsx`
- Modify: `apps/web/app/api/review/[shareId]/latest/route.ts`
- Modify: `apps/web/app/api/review/[shareId]/changelog/route.ts`
- Modify: `apps/web/app/api/assets/[assetKey]/route.ts`
- Modify: `apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/compare/route.ts`
- Modify: `apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/versions/[versionId]/comments/route.ts`
- Modify: `apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/versions/[versionId]/findings/route.ts`
- Modify: `apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/versions/[versionId]/annotations/route.ts`
- Modify: `apps/web/src/components/canvas/HandoffReviewSurface.tsx`
- Modify: `apps/web/src/components/canvas/HandoffReview.tsx`
- Modify: `apps/web/src/components/canvas/VersionCompare.tsx`
- Modify: `apps/web/src/components/canvas/LayoutFindings.tsx`
- Test: `apps/web/src/server/services/handoff-review-access.test.mjs`

**Interfaces:**
- `getHandoffReviewAccess({ shareId, inviteToken, session })` resolves access from the saved mode and published version.
- Published review URLs and read requests use `?invite=<token>` only for invite mode; public requests use the stable share id.
- Asset access accepts a share id only when the asset belongs to a version visible through that handoff's published version set.

- [ ] **Step 1: Write failing published-access tests**

Test that public reads allow only published/older versions and their assets, invite reads and comments require an active token without requiring a sign-in, and unpublished versions or unrelated assets return no access.

- [ ] **Step 2: Run the access tests and confirm expected failures**

Run: `node --test apps/web/src/server/services/handoff-review-access.test.mjs`

Expected: tests fail because the published access resolver is missing.

- [ ] **Step 3: Implement a server-only access resolver**

Use the handoff's saved sharing mode. For `anyone`, allow unauthenticated GET requests only. For `workspace`, require a workspace session. For `invited`, allow unauthenticated reads and comments with an active invite token; other writes require a signed-in session. Treat the email and role as labels, not identity checks. Never use an invite token to authorize an unrelated handoff.

- [ ] **Step 4: Connect the review page and read endpoints**

Pass only visible versions to the review surface. Allow unauthenticated reads in `anyone` mode for latest metadata, changelog, comparison, comments, annotations, QA findings, and assets; reject public writes. Keep workspace and invited access checks on existing writes.

- [ ] **Step 5: Add review tokens to client requests and make public mode read-only**

Include the review share id in asset and compare requests, and the invite token only on invite links. Hide comment creation, annotation, finding updates, task creation, integration controls, and local-preview actions from anonymous public viewers. Allow comment creation through active invite links, and keep other writes behind signed-in access.

- [ ] **Step 6: Run access tests and app type checking**

Run: `node --test apps/web/src/server/services/handoff-review-access.test.mjs apps/web/src/server/services/published-review.test.mjs`

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`

Expected: access tests pass and TypeScript reports no new diagnostics. Existing generated `.next` declaration conflicts, if present, must be reported separately from changed-file errors.

---

### Task 4: Add management UI and navigation behavior

**Files:**
- Modify: `apps/web/app/workspace/[workspaceId]/projects/[projectId]/page.tsx`
- Modify: `apps/web/app/workspace/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/page.tsx`
- Modify: `apps/web/src/components/canvas/PublishCanvasLink.tsx`
- Create: `apps/web/src/components/canvas/HandoffSharingPanel.tsx`
- Create: `apps/web/src/components/canvas/DeleteHandoffButton.tsx`
- Create: `apps/web/src/components/canvas/DeleteVersionButton.tsx`
- Test: `apps/web/src/components/canvas/handoff-management-ui.test.mjs`

**Interfaces:**
- `HandoffSharingPanel` receives the handoff ids, saved mode, published URL, invitees, and `canManageSharing`.
- Delete buttons receive their resource ids, confirmation label, and post-delete destination.

- [ ] **Step 1: Write failing UI contract tests**

Test that handoff links open a new tab safely, delete controls are included only for owner/designer page state, sharing modes render named labels, and the invite list exposes copy and revoke actions.

- [ ] **Step 2: Run the UI contract tests and confirm expected failures**

Run: `node --test apps/web/src/components/canvas/handoff-management-ui.test.mjs`

Expected: tests fail because the new controls and link behavior are missing.

- [ ] **Step 3: Add project handoff links and owner/designer delete controls**

Use `<Link target="_blank" rel="noreferrer">` for the internal handoff route and provide a separate copy-link action. Keep buttons outside the link element. Show a confirmation before sending delete requests.

- [ ] **Step 4: Add version delete and sharing controls**

Show delete buttons in version history only when the role is owner or designer. Add `Workspace members`, `Only invited`, and `Anyone with the link` choices. In invite mode, allow external work-email entry, expiry selection, copyable per-email links, and revocation.

- [ ] **Step 5: Preserve an empty handoff after deleting its last version**

Render the capture form and a clear empty state instead of calling `notFound()` when no versions remain. After version deletion, navigate to the latest remaining version or the empty state.

- [ ] **Step 6: Run UI contract tests and app type checking**

Run: `node --test apps/web/src/components/canvas/handoff-management-ui.test.mjs`

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`

Expected: focused UI checks pass and no new TypeScript errors appear.

---

### Task 5: Document behavior and verify the complete flow

**Files:**
- Modify: `README.md`
- Create: `docs/handoff-sharing.md`

- [ ] **Step 1: Document link semantics and privacy limits**

Explain workspace access, invite-token access, anonymous read-only links, manual delivery of invitations, revocation, expiry, and deletion effects. State that anyone who obtains an active invitation link can view and comment without signing in; the invite email and role are attribution labels only.

- [ ] **Step 2: Run the focused suite and build**

Run: `node --test apps/web/src/server/services/handoff-sharing.test.mjs apps/web/src/server/services/handoff-review-access.test.mjs apps/web/src/server/repositories/handoff-lifecycle.test.mjs apps/web/src/server/migrations/handoff-sharing.test.mjs apps/web/src/components/canvas/handoff-management-ui.test.mjs`

Run: `npm run build --workspace @asbir/web`

Expected: all focused tests pass and the production build completes. Report any unrelated existing build diagnostics separately.

---

## Self-review

- Spec coverage: Tasks 1–2 cover data and strict mutation authorization; Task 3 covers all published read paths and public write denial; Task 4 covers navigation, controls, and empty handoffs; Task 5 documents and builds the flow.
- Placeholder scan: no `TBD`, `TODO`, or unbounded implementation steps are used.
- Type consistency: policy is split into general access decision and database-backed review access; routes call the database-backed resolver and pass only booleans and safe values into client components.
- Inline execution: use the current worktree because it contains the user's active uncommitted changes; preserve all pre-existing paths and do not commit or reset.
