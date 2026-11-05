# Asbir Handoff design

**Status:** Ready for user review

**Date:** November 5, 2026

## Product goal

Asbir Handoff is a standalone, hosted web app where a product designer starts a frozen handoff from Figma or Paper. Product managers, developers, and QA review the same version, inspect exact design measurements, discuss changes, export assets, and pass grounded context to AI agents.

Figma and Paper remain source files. Handoff stores an immutable copy of each accepted version so later edits do not change an active review.

## User flow

1. A product designer creates a handoff from Figma, Paper, or an exported snapshot package.
2. Handoff captures a full-canvas overview, individual frames, source version information, and structured design data.
3. Handoff validates the capture and identifies any missing geometry, layout, or token fields before marking the snapshot ready for review.
4. The team reviews screens, compares versions, checks layout values, leaves comments, and exports images.
5. AI drafts a changelog, developer notes, and QA checks from the structured diff.
6. A user or agent creates linked tasks in the configured tracker. An agent reads the handoff through MCP and uses its connected code and QA tools to work on the implementation.

## Product surface

The app has team workspaces, projects, immutable handoff versions, and role-based access. Designers can create snapshots; reviewers can comment and resolve issues; developers and QA can inspect measurements, token bindings, diffs, and exports. The canvas supports zoom, pan, frame navigation, side-by-side comparison, overlay, and pixel-diff views. The inspector shows the selected element's geometry, layout properties, colors, typography, and token bindings.

The review UI is responsive across modern browsers. Detailed canvas inspection is optimized for desktop-sized screens, with viewing and commenting available on smaller screens.

## Snapshot inputs and exactness

All input methods normalize to one snapshot format:

- **Figma capture:** A Figma plugin captures the selected pages or frames, their source IDs, renders, node tree, geometry, layout properties, styles, variable bindings, and variable values. The Figma Plugin API exposes node padding and spacing properties and APIs for reading variables. See the [node properties](https://developers.figma.com/docs/plugins/api/node-properties/), [variables API](https://developers.figma.com/docs/plugins/api/figma-variables/), and [working with variables](https://developers.figma.com/docs/plugins/working-with-variables/) documentation.
- **Paper capture:** A Paper Desktop/MCP capture bridge sends the selected file or frames and their rendered and structured data to Handoff. Paper documents its MCP connection through Paper Desktop and describes its design model as HTML/CSS. The capture adapter must preserve the same geometry and token fields as the normalized format. See [Paper MCP documentation](https://paper.design/docs/mcp).
- **Snapshot package upload:** A package contains a manifest, canvas overview, frame renders, structured node data, and assets. Handoff validates the package before accepting it.
- **Image-only upload:** A user can still upload images for visual review. Handoff labels these snapshots as visual-only and does not claim exact padding, margins, or token identity.

Each node record preserves original source data and normalized fields, including source node ID, parent and frame IDs, position, dimensions, bounds, layout mode, per-edge padding, item and track spacing, alignment, constraints, fills, typography, and token/style references. Each measurement records its value, unit, source property, and provenance.

Handoff reports values without guessing:

- Padding comes from the source padding property.
- Spacing comes from an explicit source layout property when one exists.
- Margins are captured from explicit margin properties when the source provides them. Otherwise, Handoff calculates the exact distance between a selected element and its parent or sibling bounds and labels it as a measured distance. It does not present that distance as an authored CSS margin.
- A token name is shown only when the source element is bound to that token. Unbound values appear as raw values with an unlinked status.

The capture is marked ready for exact layout review only when the source adapter supplies all required geometry and layout fields. If a source cannot provide a field, the UI identifies the limitation instead of presenting an inferred value as exact. Paper's structured capture contract is an implementation validation item and must be proven against a real Paper file.

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

Handoff exposes a remote MCP server with tools and resources to list projects and versions, retrieve a snapshot or frame, inspect measurements and token bindings, compare versions, read comments and findings, draft release notes, and create a task through an enabled task-provider connection. Workspace administrators can configure task MCP connections for the app and grant scoped access. MCP credentials are workspace-scoped and access-controlled. Agents can use the Handoff MCP together with task-tracker and repository MCPs; code changes remain governed by the permissions of the connected agent and repository.

ClickUp is the first task-provider target because a ClickUp connector is available in the current workspace. The app must have its own supported ClickUp connection or a configured ClickUp MCP endpoint; it does not assume access to the chat's connector. The provider boundary remains replaceable so the product can connect other task tools.

## System boundaries

The web client provides the shared review canvas and team workflow. A backend API manages workspaces, versions, comments, rules, tasks, and access. Source adapters capture or import designs. A snapshot normalizer validates source data and stores both raw and normalized fields. A deterministic comparison and rules engine produces diffs and findings. An AI service turns those results into editable summaries. An MCP server exposes authorized handoff context and actions to agents.

The app is a TypeScript web product. Rust is not part of the initial architecture; image comparison can move to a Rust/WASM component later only if measured performance requires it.

## Acceptance criteria

- A designer can create a handoff from both Figma and Paper, and can upload a structured snapshot package.
- Each handoff preserves a reproducible canvas overview, frame renders, source identifiers, dimensions, node hierarchy, and available layout and token data.
- The inspector reports exact source padding, spacing, colors, and bound tokens. It reports margins as source values or exact measured edge distances with clear provenance.
- An image-only snapshot is usable for visual review and is clearly marked as lacking exact layout data.
- New versions retain prior snapshots and show both visual and structured diffs.
- Team members can comment on frames and elements, resolve findings, and export images.
- AI changelogs, developer notes, QA checks, and tasks reference their source evidence.
- An agent can retrieve authorized handoff context through MCP and use configured task and repository tools.
- A workspace administrator can connect an authorized task MCP, and a user or agent can create a task that links to the source handoff evidence.

## Delivery sequence

1. Define and validate the snapshot format, including a Paper capture proof against a real Paper file.
2. Build the hosted workspace, structured import, canvas review, comments, inspector, and deterministic version diffs.
3. Add source-initiated capture for Figma and Paper, then exercise the import validator with both.
4. Add configurable layout rules, AI changelog and QA drafts, the remote MCP server, and ClickUp task creation.
5. Validate the complete designer-to-review-to-task-to-agent workflow with real snapshots from both source tools.

## Open implementation assumptions

- The first team uses invite-based workspace access; a specific SSO provider is not required for the first release.
- Figma capture uses a plugin so it can collect node properties and token bindings in one source-side action. The REST Variables endpoint has separate plan and scope requirements, so the plugin capture path avoids depending on REST token access for the core data contract; see the [Variables REST API requirements](https://developers.figma.com/docs/rest-api/variables-endpoints/).
- The Paper capture bridge must be tested against real Paper files before claiming complete structural fidelity.
- Task creation is available through ClickUp first; other providers can be added through the same task-provider boundary or connected agent MCPs.
