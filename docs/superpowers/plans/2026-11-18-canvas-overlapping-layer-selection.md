# Canvas overlapping layer selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let reviewers select deeper overlapping Figma layers with Option/Alt-click or Cmd-click in the canvas.

**Architecture:** Reuse the canvas's existing transparent layer buttons and `document.elementsFromPoint()` to read the hit stack from front to back. A modifier-click advances from the currently selected layer to the next lower hit, stopping at the deepest; an ordinary click keeps selecting the event's layer button.

**Tech Stack:** Next.js, React, TypeScript, DOM hit testing.

## Global Constraints

- In Inspect mode, a plain click selects the topmost captured layer under the pointer.
- Option/Alt-click or Cmd-click selects the next captured layer behind the current hit; repeated modifier-clicks at the same point step deeper.
- When the current selection is outside the hit stack, the first modifier-click skips the topmost layer and selects the next one. If there is only one hit, select it.
- Stop at the deepest hit; do not wrap to the top.
- Keep comment and annotation placement semantics unchanged.
- Keep Option/Alt-hover distance guides available when the pointer is over a different layer.
- Do not change selection state, capture formats, persistence, APIs, or inspector behavior.
- Do not add or run tests under the current session instructions; use focused static checks instead.

## File map

- Modify `apps/web/src/components/canvas/CanvasViewport.tsx` to read overlapping layer targets from the browser hit stack and choose the next layer for modifier-clicks.

## Task 1: Step through overlapping canvas layers

**Files:**

- Modify: `apps/web/src/components/canvas/CanvasViewport.tsx`
- Tests: None. The current session instructions prohibit adding or running tests unless requested.

**Interfaces:**

- Consume: `overlayNodesById` to restrict hit-stack IDs to the active canvas frame; `selectedNodeId` to find the current layer's stack position; `node.sourceNodeId` as a fallback to the clicked target.
- Produce: No new exports, state, or persisted data.

- [x] **Step 1: Read the browser hit stack in the layer button click handler**

Keep the existing drag suppression first. Keep comment and annotation clicks unchanged. For an ordinary click, call `onSelectNode(node.sourceNodeId)`. For an Option/Alt-click or Cmd-click, collect unique IDs in front-to-back order from `document.elementsFromPoint(event.clientX, event.clientY)`, using each element's nearest `[data-source-node-id]` and retaining only IDs present in `overlayNodesById`. If the clicked button ID is missing, prepend it as a fallback.

```tsx
if (!commentMode && !annotationMode) {
  if (!event.altKey && !event.metaKey) {
    onSelectNode(node.sourceNodeId);
    return;
  }

  event.preventDefault();
  const stack = [...new Set(document.elementsFromPoint(event.clientX, event.clientY).flatMap((element) => {
    const id = element.closest<HTMLElement>("[data-source-node-id]")?.dataset.sourceNodeId;
    return id && overlayNodesById.has(id) ? [id] : [];
  }))];
  if (!stack.includes(node.sourceNodeId)) stack.unshift(node.sourceNodeId);

  const selectedIndex = selectedNodeId ? stack.indexOf(selectedNodeId) : -1;
  const nextIndex = selectedIndex >= 0
    ? Math.min(selectedIndex + 1, stack.length - 1)
    : Math.min(1, stack.length - 1);
  onSelectNode(stack[nextIndex] ?? node.sourceNodeId);
}
```

- [x] **Step 2: Preserve interaction boundaries**

Keep the existing `suppressClickRef` guard before selection. Do not select from the node button while `commentMode` or `annotationMode` is active, so the event continues to the canvas handler for comment or annotation placement. Leave `altHeld`, hover tracking, and distance-guide rendering unchanged.

- [x] **Step 3: Run focused static checks**

Run from the repository root:

```bash
npm exec --workspace @asbir/web -- eslint src/components/canvas/CanvasViewport.tsx
git diff --check
```

Expected: ESLint exits with code 0 and `git diff --check` reports no whitespace errors. Do not run automated tests.

- [x] **Step 4: Review the diff**

Confirm that only `CanvasViewport.tsx` contains implementation changes, the existing untracked `.claude/`, `pnpm-lock.yaml`, and `work/` files remain untouched, and the interaction matches `docs/superpowers/specs/2026-11-18-canvas-overlapping-layer-selection-design.md`.
