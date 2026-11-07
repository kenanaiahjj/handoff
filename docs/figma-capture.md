# Figma capture and snapshot import

Asbir Handoff imports a frozen canvas as an immutable handoff version. The Figma plugin captures the selected artboards or the top-level frames and components on the current page, then uploads the render images and structured source data as one version.

## Build and load the plugin

1. Start the web app with `npm run dev`.
2. Build the plugin with `npm run build --workspace @asbir/figma-plugin`.
3. In Figma, choose **Plugins → Development → Import plugin from manifest…**.
4. Select `integrations/figma-plugin/manifest.json`.

Run `npm run test --workspace @asbir/figma-plugin` and `npm run lint --workspace @asbir/figma-plugin` to check the capture and type paths.

For a deployed Handoff server, build the plugin with its public URL:

```sh
HANDOFF_PUBLIC_URL=https://handoff.example.com npm run build --workspace @asbir/figma-plugin
```

The manifest declares dynamic page access, which Figma requires for new plugins. The build configures network access for the Handoff capture endpoint. Figma’s plugin UI runs in a browser frame with a `null` origin, so the upload endpoint permits wildcard CORS. The endpoint accepts only a short-lived, single-use bearer token and does not use cookies. See Figma’s [plugin manifest documentation](https://developers.figma.com/docs/plugins/manifest/) and [network request guide](https://developers.figma.com/docs/plugins/making-network-requests/).

## Capture and upload a version

1. In Handoff, open the project that owns the handoff.
2. Start a Figma capture session. Choose an existing handoff or enter a name for a new handoff, then set the version label and release note.
3. Copy the one-time token. It expires after 10 minutes.
4. In Figma, open **Asbir Handoff Capture**. Confirm the Handoff server and paste the one-time token. The URL is set when the plugin is built so it matches Figma's allowed network endpoint.
5. Choose **Selected frames or components** to capture the selected artboards. When you select a layer inside an artboard, the plugin captures its closest containing frame. Choose **All top-level frames and components on this page** to capture every top-level artboard on the current page.
6. Select **Capture canvas**. Review the overview, frame count, and layer count.
7. Select **Upload frozen snapshot**. Handoff creates the first version or appends a new immutable version, then returns a link to the review page.

The plugin exports each artboard as a PNG through Figma for the visual render. It also retains an SVG companion with text converted to outlines and layer-name IDs when Figma can provide one within the transfer limit. An unavailable SVG companion does not block the PNG render or layer data. Each frame uses 2× when its own area is at most 3 million pixels; larger frames start at 1×. If a 2× PNG export fails or exceeds the remaining transfer budget, the plugin retries that frame at 1×. It does not replace a missing Figma render with an image-only or browser-rendered snapshot. The overview combines the PNG renders at their source-canvas positions. Handoff displays the PNG render for pixel fidelity and links any available SVG source to the frame. The layer hierarchy, geometry, styles, typography, and variable bindings remain separate structured data, so the canvas is inspectable rather than image-only.

Capture walks page and layer trees iteratively, stops as soon as the frame or layer limit is exceeded, and bounds asynchronous metadata lookups. This avoids recursive stack growth and unbounded bursts of Figma API calls on deep or large files. Structured data is size-checked before Figma exports begin. Captures above the documented limits must be split into smaller selections.

Variable and style lookups are optional enhancements. If those lookups fail, the plugin keeps the Figma pixel render, full layer hierarchy, geometry, and other readable properties, then surfaces a warning before upload. A failure to capture the Figma render or structured layer tree stops the capture so the plugin cannot upload a misleading partial snapshot.

The structured data includes source node IDs and hierarchy, frame-relative bounds, exact auto-layout padding and spacing when Figma provides them, paints, typography, style references, and variable bindings. Reviewers can select captured layers and inspect their measurements, corner radii, colors, fonts, and token bindings. It records only variables actually bound to captured nodes. The plugin does not guess a token by matching a color or number.

Figma does not expose a revision ID to this capture flow, so `sourceRevisionId` is `null`. The snapshot records the Figma file ID, name, page ID and name, capture time, and adapter version.

## Measurement provenance

Handoff marks a property as `source` when Figma provides it directly, `measured` when the adapter calculates it from captured geometry, and `unavailable` when Figma does not provide the value.

- Bounds use Figma's absolute bounding boxes. Node x/y values are converted to frame-relative coordinates for the canvas overlay.
- Padding and auto-layout spacing use Figma's source values. A non-auto-layout layer does not get a fabricated padding value.
- Auto-layout grids retain row and column counts, gaps, track types and values (`FIXED`, `FLEX`, or `HUG`), automatic-row behavior, and item placement mode. Direct grid children retain their row and column indices, spans, and cell alignment. The inspector presents the track sizes and selected item's placement.
- Figma frame layout grids (`ROWS`, `COLUMNS`, and `GRID`) retain their source size, count, alignment, offset, gutter, color, and bound variables. Select **Grid** in the canvas toolbar to show captured visible grids over the frozen screens. Figma's automatic row or column count is stored as `AUTO`, not as a fabricated fixed count.
- Figma does not have CSS margins. Handoff labels the edge distance from a layer to its immediate parent as a measured margin. The distance can be negative when layers overlap or extend outside the parent.
- The full raw paint data is retained in `sourcePayload`; the color summary shows a hex value for solid paints.
- A project spacing rule checks measured margins along with padding and layout gaps when the team configures an allowed spacing scale.
- The inspector rounds pixel values to whole or half-pixel increments for display. The frozen snapshot and MCP measurement response keep the captured source values.

## Import validation and storage

Before creating a version, Handoff checks the snapshot schema, source tool, asset list, content types, file names, byte counts, per-file SHA-256 hashes, and the hash of the structured snapshot. A capture session can be used once. Handoff stores the accepted snapshot, pixel renders, and linked SVG sources as a new immutable version; later captures create new versions that the app can compare.

The web app also accepts a source-agnostic structured ZIP package described in [snapshot-package.md](snapshot-package.md). Direct Paper MCP capture is deferred. A package can provide exact layout and token data when its exporter includes source geometry and bindings; image-only upload supports visual review but does not provide those properties.

## Limits

- A plugin capture can contain up to 120 artboards and 20,000 layers.
- A snapshot upload can contain up to 300 assets and 100 MiB of render data.
- Structured snapshot JSON is limited to 16 MiB.
- A full-page capture includes top-level frames and components found under sections and groups. Loose page-level text, shapes, and notes outside those artboards are not included.
- Review the capture preview before uploading. If a page exceeds these limits, capture a smaller selection and create separate handoffs or versions.
