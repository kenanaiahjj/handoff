---
version: alpha
name: Asbir Handoff
description: Versioned design handoffs for product, engineering, and QA teams.
colors:
  background: "#1e1e1e"
  surface: "#202020"
  surface-raised: "#303030"
  surface-inset: "#171717"
  foreground: "#ededed"
  foreground-muted: "#b0b0b0"
  foreground-subtle: "#929292"
  border: "#383838"
  border-strong: "#4a4a4a"
  primary: "#dedede"
  primary-hover: "#f2f2f2"
  primary-foreground: "#171717"
  accent: "#83a878"
  capture-action: "#dedede"
  capture-action-hover: "#f2f2f2"
  capture-action-foreground: "#171717"
  ai-accent: "#83a878"
  ai-accent-foreground: "#171717"
  success: "#83a878"
  warning: "#d7b86e"
  danger: "#d2786f"
typography:
  figmaPlugin:
    fontFamily: system-ui
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  micro:
    fontFamily: Geist Mono
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.4
  compactLabel:
    fontFamily: Geist
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.3
  compactBody:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
  label:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.3
  data:
    fontFamily: Geist Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
rounded:
  control: 6px
  surface: 10px
  panel: 14px
  project-panel: 20px
  pill: 9999px
spacing:
  "1": 4px
  "2": 8px
  "3": 12px
  "4": 16px
  "6": 24px
  "8": 32px
---

# Design System: Asbir Handoff

## Overview

Use the user's November 5, 2026 OneQR Handoff screenshot as the visual and interaction reference for the review canvas. Reproduce its compact full-width command bar, screen list, dotted canvas, change badges, and right-side inspector. Label the standalone shell Asbir Handoff. Show the handed-off project's name in version and snapshot context; OneQR is an example project, not the shell brand.

Use Abstract for Sketch as an additional product reference for version history and change review. Its version-control workflow can inform how handoff versions and their changes are organized.

The review canvas shows the source app's frozen snapshot. Keep its pixels unchanged. Frame outlines, selection, comment pins, and inspection controls belong to the handoff layer around that snapshot.

## Colors

Use one charcoal palette across the workspace, settings, and review canvas: `#202020` for app chrome and panels, `#1e1e1e` for canvas and inset surfaces, `#303030` for raised controls, and `#383838` for quiet separators. Use white and gray for type. Use neutral light-gray primary actions across the app. Reserve restrained moss green for new and success states, and warm amber for changed screens. Every status uses a text label as well as color.

## Typography

Use the platform system UI font for the Figma plugin interface, with platform fallbacks in the CSS stack. Use Geist for Handoff interface text and Geist Mono for measurements, identifiers, source values, and compact metadata. Keep the toolbar and screen list dense but readable. Instructions and comment text must remain readable at browser zoom; use micro text only for secondary metadata and counts.

## Layout

Fill the desktop viewport with a 48px command bar and a three-pane review workspace. Keep the screen list near 240px, the inspector near 300px, and let the dotted canvas take the remaining width. Let the screen list and inspector scroll independently. On small screens, stack the screen selector, canvas, and inspector while keeping the toolbar controls available.

Keep the screen inventory searchable. Show changed and new badges, and provide a changed-only filter. The canvas must show the captured overview with source-aligned frame outlines when the snapshot contains exact bounds. Selecting a screen or element updates the inspector without changing the frozen image.

## Interaction patterns

- Workspace Owners and Designers can create handoffs, capture Figma versions, add versions, edit changelogs, and publish. Product managers (Reviewer role), developers, and QA cannot start a handoff; they open a published canvas link directly into this review surface.
- Provide an install action that opens the browser's PWA prompt when available and gives platform-specific install instructions otherwise. Support macOS Safari's Add to Dock flow and Windows Chrome or Edge installation.
- Publishing creates one stable link per handoff. Keep that link pinned to the latest published version; hide unpublished versions from recipients.
- The version selector switches immutable snapshots and shows capture metadata and change counts.
- Comments opens the review thread panel. Team members can filter open and resolved threads, show or hide resolved pins, add comments on a canvas point or selected element, reply, resolve, and reopen.
- Search opens a keyboard-accessible finder for captured text, colours, and elements across screens. Support `⌘F`, arrow-key navigation, `Enter` to select, `Shift+Enter` to highlight results, and `Esc` to close.
- Outlines toggles source-element bounds. Support the `O` shortcut.
- Fit frames the captured canvas in the viewport. Support `Shift+1`, plus pointer-wheel zoom, pan, and explicit zoom controls.
- Selecting an element shows its comments, geometry, layout, padding, measured margins, spacing, appearance, typography, and bound tokens. Clicking a value copies it. Provide copy CSS, copy link, parent navigation, and before-and-after comparison when a prior version exists.
- Select elements directly on the canvas; do not require a separate View/Inspect mode. Keep outline visibility as an independent canvas control.
- When a text element contains multiple Figma styles, show exact per-run typography, fills, and token bindings in a compact disclosure.
- Hold `Alt` while pointing at a second element to show the distance from the selected element.
- Group component states only when the source capture provides enough metadata to distinguish states from separate screens.

## Elevation & Depth

Separate panels with tonal shifts; omit an outer border when surface contrast already defines the section. Use quiet separators between adjacent content and reserve stronger borders for inputs, selection, and focus. Use the dotted canvas as the visual anchor. Keep menus and temporary search surfaces above the canvas with a restrained shadow.

## Shapes

Use compact radii of about 5–8px for controls and panels. Avoid oversized cards and decorative pills in the review chrome.

## Accessibility

Meet WCAG 2.2 AA. Preserve visible keyboard focus, keyboard operation, screen-reader labels, reduced-motion preferences, and text labels for status colors. Do not rely on color or position alone to explain an action.

## Measurement rules

- Identify measurement provenance as source, measured, or unavailable.
- Display pixel measurements rounded to the nearest whole or half pixel, and use the same value in copy actions.
- Display Figma corner radii after Figma's edge-length clamp. Keep the raw source radius visible and copyable when the clamp changes it. Export the effective radius in copied CSS.
- Do not label a measured edge distance as an authored CSS margin.
- Do not infer a token binding from a matching raw value.
