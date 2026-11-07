# Asbir Handoff design

**Status:** Approved by user

**Date:** November 5, 2026

## Product goal

Asbir Handoff is a standalone, hosted web app where a product designer starts a frozen handoff from Figma or uploads a structured snapshot package. Product managers, developers, and QA review the same version, inspect exact design measurements, discuss changes, export assets, and pass grounded context to AI agents.

Figma remains the source file. Handoff stores an immutable copy of each accepted version so later edits do not change an active review. Direct Paper MCP capture is deferred; the package format remains source-agnostic.

## User flow

1. A product designer creates a handoff with the Figma plugin or uploads a structured snapshot package. A workspace owner can also act as the designer. A project can have a PD-in-charge who is a regular workspace member, not an owner. While the team checks the end-to-end flows, role gates do not block capture, publishing, or review.
2. Handoff captures a full-canvas overview, individual frames, source version information, and structured design data.
3. Handoff validates the capture and identifies any missing geometry, layout, or token fields before marking the snapshot ready for review.
4. The designer publishes a version and shares its stable canvas URL. Product managers (Reviewer role), developers, and QA sign in to their workspace account and land directly in the review canvas. They review published screens, compare versions, check layout values, leave comments, and export images.
5. AI drafts a changelog, developer notes, and QA checks from the structured diff. The designer edits and approves the draft; approved notes appear in the published canvas, and each evidence link opens its source version, screen, or element. Unapproved drafts stay off the published recipient view.
6. A user or agent creates a task with tools already connected to their AI client, then records the task in Handoff through the `link_task` MCP tool or the review UI. An agent reads the handoff through MCP and uses its own repository and QA tools to work on the implementation.

The published URL stays stable as the designer publishes later versions. Recipients see the latest published version; a newer draft is not available through the review URL.

## Product surface

The app has team workspaces, projects, immutable handoff versions, and member roles. Product designers, product managers, developers, and QA share the canvas and can comment, inspect measurements and token bindings, compare versions, and export images. During flow checks, roles do not gate capture, publishing, or review. When role-specific permissions are enabled, workspace ownership and project PD-in-charge are separate: an owner can do PD work, and a PD-in-charge does not need to be a workspace owner. The canvas supports zoom, pan, frame navigation, side-by-side comparison, overlay, and pixel-diff views. The inspector shows the selected element's geometry, layout properties, colors, typography, and token bindings.

Use the OneQR Handoff reference for the review canvas layout, controls, interactions, and visual treatment. Use Linear as a quality bar for compact, precise UI. The snapshot canvas preserves the source app's captured visuals; shell branding and styles do not alter the source design. OneQR is an example of a handed-off app, not the product shell. The screen inventory supports search, explicit Changed and New labels, a changed-screen filter, a summary against the earlier version, and a direct before-and-after action for each changed screen.

The review UI is responsive across modern browsers. Detailed canvas inspection is optimized for desktop-sized screens, with viewing and commenting available on smaller screens.

Asbir Handoff can be installed as a desktop web app on macOS and Windows. The web manifest provides the app name, standalone display mode, and branded icons. The app exposes the browser install prompt where supported and shows platform-specific steps for Safari's Add to Dock flow.

## Snapshot inputs and exactness

All input methods normalize to one snapshot format:

- **Figma capture:** A Figma plugin captures the selected pages or frames, their source IDs, renders, node tree, geometry, layout properties, styles, variable bindings, and variable values. The Figma Plugin API exposes node padding and spacing properties and APIs for reading variables. See the [node properties](https://developers.figma.com/docs/plugins/api/node-properties/), [variables API](https://developers.figma.com/docs/plugins/api/figma-variables/), and [working with variables](https://developers.figma.com/docs/plugins/working-with-variables/) documentation.
- **Snapshot package upload:** A package contains a manifest, canvas overview, frame renders, structured node data, and assets. Handoff validates the package before accepting it.
- **Image-only upload:** A user can still upload images for visual review. Handoff labels these snapshots as visual-only and does not claim exact padding, margins, or token identity.

Each node record preserves original source data and normalized fields, including source node ID, parent and frame IDs, position, dimensions, bounds, layout mode, per-edge padding, item and track spacing, alignment, constraints, fills, typography, and token/style references. Each measurement records its value, unit, source property, and provenance.

Handoff reports values without guessing:

- Padding comes from the source padding property.
- Spacing comes from an explicit source layout property when one exists.
- Margins are captured from explicit margin properties when the source provides them. Otherwise, Handoff calculates the exact distance between a selected element and its parent or sibling bounds and labels it as a measured distance. It does not present that distance as an authored CSS margin.
- A token name is shown only when the source element is bound to that token. Unbound values appear as raw values with an unlinked status.

The capture is marked ready for exact layout review only when the source adapter supplies all required geometry and layout fields. If a source cannot provide a field, the UI identifies the limitation instead of presenting an inferred value as exact.

## Versioning and comparisons

Every handoff version stores its source identity, source version or revision, capture time, content hash, canvas overview, frame renders, node tree, tokens/styles, and assets. A later handoff creates a new record; it never overwrites an earlier review.

The comparison engine generates two kinds of diffs:

- **Visual diff:** Pixel difference, overlay, and before/after views for matching frames.
- **Structured diff:** Added, removed, or changed frames and nodes; geometry and layout changes; text and style changes; and token binding or token value changes.

Source node IDs are the primary matching key. If a source cannot preserve IDs between versions, Handoff presents candidate matches for review and records the selected mapping. AI can describe computed changes but does not decide whether two elements match or invent measurements.

Comments attach to an immutable version and frame. When possible, they also reference a source node ID; otherwise, they use frame-relative coordinates. A comment remains attached to the version where it was created, with an optional link to the corresponding element in a later version.

## Layout checks and rules

The measurement inspector exposes exact padding, spacing, margins or derived edge distances, frame size, node bounds, color values, typography, and token/style bindings. A deterministic rules engine checks captured values against workspace or project rules, such as approved spacing values and required token use. Rules are configurable; Handoff does not assume an organization's spacing scale or token policy.

Each finding includes the value, rule, frame, and element that produced it. The team can assign, comment on, resolve, or export findings for development and QA.

## AI and MCP

AI uses the deterministic structured diff and layout findings to draft:

- A product summary and changelog
- Developer implementation notes
- QA scenarios and acceptance criteria
- Proposed tasks with links to the relevant frames, elements, diffs, and findings

Every generated statement must link to its supporting source evidence. Users can edit generated content before publishing it. AI must not infer token identities or exact spacing when the source data does not provide them.

Handoff exposes a remote MCP server with tools to list projects, handoffs, and versions; retrieve snapshots and frames; inspect measurements and token bindings; compare versions; read comments, findings, and linked tasks; draft release notes; and record an externally created task with `link_task`. An AI client can connect to Handoff alongside its own ClickUp, Linear, repository, or QA MCP tools. The client creates tasks or performs code work through those tools, then can link the result back to the exact Handoff version, screen, or element. Handoff does not connect to or store credentials for those external tools, and it does not execute code. MCP tokens for Handoff are workspace-scoped and access-controlled.

## System boundaries

The web client provides the shared review canvas and team workflow. A backend API manages workspaces, versions, comments, rules, tasks, and access. Source adapters capture or import designs. A snapshot normalizer validates source data and stores both raw and normalized fields. A deterministic comparison and rules engine produces diffs and findings. An AI service turns those results into editable summaries. An MCP server exposes authorized handoff context and actions to agents.

The app is a TypeScript web product. Rust is not part of the initial architecture; image comparison can move to a Rust/WASM component later only if measured performance requires it.

## Acceptance criteria

- A designer can create a handoff with the Figma plugin or upload a structured snapshot package.
- During flow checks, workspace members can exercise capture, publishing, and review without role gates. When role gates are enabled later, a workspace owner can act as the PD, and a project PD-in-charge can be any workspace member. Product managers, developers, and QA use the review canvas. Publishing creates a stable URL that opens recipients directly into the canvas and exposes only published versions.
- Each handoff preserves a reproducible canvas overview, frame renders, source identifiers, dimensions, node hierarchy, and available layout and token data.
- The inspector reports exact source padding, spacing, colors, and bound tokens. It reports margins as source values or exact measured edge distances with clear provenance.
- An image-only snapshot is usable for visual review and is clearly marked as lacking exact layout data.
- New versions retain prior snapshots and show both visual and structured diffs.
- Team members can comment on frames and elements, resolve findings, and export images.
- AI changelogs, developer notes, QA checks, and tasks reference their source evidence.
- The published canvas shows only approved changelog notes for published versions, with links to the supporting version, screen, or element.
- An agent can retrieve authorized handoff context through MCP and use the AI client's own task, repository, and QA tools.
- A user or agent can record an externally created task with `link_task`; the link preserves the selected immutable version and optional screen or element evidence.
- Handoff does not store credentials for external task, repository, or QA tools.

## Delivery sequence

1. Define and validate the source-agnostic snapshot format.
2. Build the hosted workspace, structured import, canvas review, comments, inspector, and deterministic version diffs.
3. Add source-initiated Figma capture and exercise the import validator with a real Figma file. Direct Paper MCP capture is deferred.
4. Add configurable layout rules, AI changelog and QA drafts, the remote MCP server, and links to tasks created by the team's AI client.
5. Validate the complete designer-to-review-to-task-to-agent workflow with real Figma snapshots and source-agnostic package imports.

## Open implementation assumptions

- The first team uses invite-based workspace access; a specific SSO provider is not required for the first release.
- Figma capture uses a plugin so it can collect node properties and token bindings in one source-side action. The REST Variables endpoint has separate plan and scope requirements, so the plugin capture path avoids depending on REST token access for the core data contract; see the [Variables REST API requirements](https://developers.figma.com/docs/rest-api/variables-endpoints/).
- Direct Paper MCP capture is out of scope for the current phase and needs a separate design and validation pass if resumed.
- The AI client owns connections to ClickUp, Linear, repositories, and QA tools. Handoff stores links and design evidence for external work; it does not integrate directly with those providers.
