# Confirm screen matches in version compare

**Goal:** Let a reviewer explicitly pair a removed Figma screen with its new-ID candidate so the compare view can show a true before-and-after render.

**Architecture:** Keep version snapshots immutable. Persist a confirmed frame mapping in the existing `handoff_frame_replacement` table, scoped to the selected version pair and the confirming user. Validate every request against the diff's unmatched candidates, then return the recomputed comparison so the client can focus the newly paired screen.

**Tech stack:** Next.js Route Handlers, TypeScript, SQLite, Zod, React, Node's test runner.

## Constraints

- Never merge a candidate frame automatically.
- Require an explicit user action for every frame match.
- Verify both versions belong to the route's handoff and workspace.
- Preserve the stored snapshots and their content hashes.
- Use the existing replacement table; add no schema migration.
- Execute inline without subagents, as requested.

## Task 1: Validate and persist frame matches

**Files:**

- Modify `apps/web/src/server/repositories/versions.ts` to store a confirmed mapping and resolve direct-pair mappings alongside existing adjacent-version mappings.
- Create `apps/web/src/server/services/frame-replacements.ts` for pure mapping resolution.
- Create `apps/web/src/server/services/frame-replacements.test.mjs` for direct, chained, and reverse comparison mappings.
- Modify `apps/web/src/server/services/diff.test.mjs` to prove a same-name candidate stays separate until explicitly mapped.
- Modify `apps/web/app/api/workspaces/[workspaceId]/projects/[projectId]/handoffs/[handoffId]/compare/route.ts` with a validated `POST` operation.

**Behavior:** The server accepts `{ fromVersionId, toVersionId, beforeFrameId, afterFrameId }`, checks the authenticated workspace member, loads both versions from the same handoff, verifies the pair appears in `unmatchedFrameCandidates`, and records it. Repeated submissions of the exact same match are idempotent. A conflicting mapping returns `409`.

**Tests:** Run the new frame replacement test and `diff.test.mjs` with `node --experimental-strip-types --test`. Verify direct and reversed pair mappings resolve to the same frame pair, and an unmatched candidate becomes a paired frame only when the explicit mapping is supplied.

## Task 2: Add the compare-panel confirmation control

**Files:**

- Modify `apps/web/src/components/canvas/VersionCompare.tsx`.

**Behavior:** Show each removed screen and its candidate newer screens in the comparison sidebar. Each candidate has a clearly named confirmation button. While saving, disable duplicate submissions and announce progress. On success, replace the candidate notice with the paired diff and focus the new screen. On failure, keep the candidate visible and show the server's actionable error.

**Verification:** Run `npx tsc --noEmit`, `npm run lint --workspace @asbir/web`, and `npm run build --workspace @asbir/web`. In the local Tripket test handoff, confirm the same-name Review screen candidate and verify that both renders appear in side-by-side mode with captured changes listed.
