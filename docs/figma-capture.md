# Figma capture and snapshot import

Asbir Handoff imports a frozen canvas as an immutable handoff version. The Figma plugin can capture selected artboards, all top-level frames and components on the current page, or those objects across every page in the Figma file. It uploads the snapshot JSON and render assets directly to private Supabase Storage, then sends Handoff a small JSON manifest to finalize the version.

## Build and load the plugin

1. Start the web app with `npm run dev`.
2. Build the plugin with `npm run plugin:build:local`. This build points both Handoff and Storage at `http://localhost:3000`: uploads go to the local dev server's signed upload routes and are kept under `apps/web/data/objects`, not Supabase Storage.
3. In Figma, choose **Plugins → Development → Import plugin from manifest…**.
4. Select `integrations/figma-plugin/manifest.json`.

Run `npm run test --workspace @asbir/figma-plugin` and `npm run lint --workspace @asbir/figma-plugin` to check the capture and type paths.

For a deployed Handoff server, build the plugin with its public URL and Supabase project URL:

```sh
HANDOFF_PUBLIC_URL=https://handoff.example.com SUPABASE_URL=https://your-project-ref.supabase.co npm run build --workspace @asbir/figma-plugin
```

The manifest declares dynamic page access, which Figma requires for new plugins. The build allows only the configured Handoff capture routes and exact Supabase Storage host. The plugin bundle contains no Supabase API key or service-role key. The Handoff endpoints use a short-lived, single-use bearer token and do not use cookies. Configure Storage CORS for the Figma plugin origin and the signed upload and TUS methods and headers. See Figma’s [plugin manifest documentation](https://developers.figma.com/docs/plugins/manifest/) and [network request guide](https://developers.figma.com/docs/plugins/making-network-requests/).

## Capture and upload a version

1. In Handoff, open the project that owns the handoff.
2. Start a Figma capture session. Choose an existing handoff or enter a name for a new handoff, then set the version label and release note.
3. Copy the one-time token. It expires after one hour, giving large Figma captures time to finish before upload.
4. In Figma, open **Asbir Handoff Capture**. Confirm the Handoff server and paste the one-time token. The URL is set when the plugin is built so it matches Figma's allowed network endpoint.
5. Choose **Selected frames, components, or sections**, **All top-level frames and components on this page**, or **Entire Figma file (all pages)**. The file option loads pages sequentially and arranges their captured frames into separate regions in the overview.
6. Select **Capture canvas**. Review the overview, page count, frame count, and layer count. The plugin flags repeated screen names in the captured scope because duplicates can make version matching ambiguous. Rename them in Figma when possible; the warning does not block upload.
7. Select **Upload frozen snapshot**. The plugin requests signed paths and uploads the snapshot JSON and render assets directly to private Storage. Files up to 6 MiB use signed `PUT` requests. Larger files use TUS resumable uploads with 6 MiB chunks. Handoff receives only the upload declarations and final object paths, not the file bytes. Handoff verifies the snapshot and asset hashes before creating the first version or appending a new immutable version, then returns a link to the review page. In an existing handoff, a selected-frame capture updates those frames and preserves everything else. A page capture replaces only that page’s frames and retains frames from other pages. An entire-file capture replaces the full canvas. Confirm a suggested frame-name match when Figma assigns a replacement frame a new ID so the partial capture can replace the intended frame. In version comparison, Handoff automatically pairs exact screen names that are unique in both captures when the verified Figma file ID matches; this does not add a confirmation prompt to the canvas.

### Section captures

Select a Figma **section** (with the selected scope) to capture every top-level frame, component, and instance inside it, including those in nested sections. The snapshot records the section in `sourceMetadata.sections` (`sourceSectionId`, page, bounds, first visible solid fill, name, and the captured `frameIds`), and the canvas draws it under its screens with its fill and name.

A section capture replaces that section in the handoff rather than adding to it. Screens the previous version had in the section that are no longer in it are removed from the new version (listed in `sourceMetadata.sectionRemovedFrameIds`), new screens are added, and changed screens update. Screens captured outside the section, loose frames and other sections, are left alone. Rules for edge cases:

- A screen whose Figma ID changed still replaces its earlier copy when its name is unique, or when you confirm the suggested match, instead of being removed.
- Screens you untick in the plugin's frame list are kept as they were (recorded as `skippedFrameIds`), not removed.
- A screen moved from one section into a re-captured section leaves the old section's outline.
- Nested sections fold into the selected outer section. If you select a section and its parent, the parent wins.
- Selecting frames inside a section (not the section itself) stays an additive frame capture and never removes screens.
- A section can be selected together with loose frames: the section is replaced and the loose frames are added.
- Page and file captures also record the page's top-level sections so the canvas can draw them; a page capture replaces that page's sections along with its screens.

The replacement check sends Handoff a compact summary of the captured frames. The final request contains `snapshotPath`, an `assets` map from asset keys to staged object paths, `baselineVersionId`, and `frameMatches`. The plugin keeps the captured snapshot in memory while uploads run. Retry reuses that same capture and resumes an interrupted TUS upload. A completed signed path is not overwritten. If Handoff reports an integrity failure, the plugin asks for fresh scoped paths and resends the same bytes. If an upload began before the one-hour capture token expires, the plugin renews the active capture session before retrying. Handoff consumes the capture token only after successful finalization.

The plugin exports each artboard as a PNG through Figma for the visual render. It also retains an SVG companion with text converted to outlines and layer-name IDs when Figma can provide one within the transfer limit. An unavailable frame SVG companion does not block the PNG render or layer data. For individual vector-layer exports, the plugin retries a failed SVG export as a 1× PNG; it reports when both formats fail. Individual layer image exports are optional and capped at 256 assets, 20 MiB total, and 5 MiB per asset. Reaching those limits does not remove the captured layer tree or its properties. Each frame uses 2× when its own area is at most 3 million pixels; larger frames start at 1×. If a 2× PNG export fails or exceeds the remaining transfer budget, the plugin retries that frame at 1×. It does not replace a missing frame render with an image-only or browser-rendered snapshot. The overview combines the PNG renders at their source-canvas positions. Handoff displays the PNG render for pixel fidelity and links any available SVG source to the frame. The layer hierarchy, geometry, styles, typography, and variable bindings remain separate structured data, so the canvas is inspectable rather than image-only.

Capture walks page and layer trees iteratively and bounds asynchronous metadata lookups. In full-file mode, the plugin loads one Figma page at a time. This avoids recursive stack growth and unbounded bursts of Figma API calls on deep or large files. Structured data is size-checked before Figma exports begin. A failed page load or exceeded safety budget stops the full capture; the plugin does not upload a partial file as if it were complete.

Variable and style lookups are optional enhancements. If those lookups fail, the plugin keeps the Figma pixel render, full layer hierarchy, geometry, and other readable properties, then surfaces a warning before upload. A failure to capture the Figma render or structured layer tree stops the capture so the plugin cannot upload a misleading partial snapshot.

The structured data includes source node IDs and hierarchy, frame-relative bounds, exact auto-layout padding and spacing when Figma provides them, paints, typography, style references, and variable bindings. Reviewers can select captured layers and inspect their measurements, corner radii, colors, fonts, and token bindings. It records only variables actually bound to captured nodes. The plugin does not guess a token by matching a color or number.

Figma does not expose a revision ID to this capture flow, so `sourceRevisionId` is `null`. The snapshot records the Figma file ID, name, capture time, and adapter version. A selected or page capture also records its page ID and name; a file capture records each page in its page layout metadata.

## Measurement provenance

Handoff marks a property as `source` when Figma provides it directly, `measured` when the adapter calculates it from captured geometry, and `unavailable` when Figma does not provide the value.

- Bounds use Figma's absolute bounding boxes. Node x/y values are converted to frame-relative coordinates for the canvas overlay.
- Padding and auto-layout spacing use Figma's source values. A non-auto-layout layer does not get a fabricated padding value.
- Auto-layout grids retain row and column counts, gaps, track types and values (`FIXED`, `FLEX`, or `HUG`), automatic-row behavior, and item placement mode. Direct grid children retain their row and column indices, spans, and cell alignment. The inspector presents the track sizes and selected item's placement.
- Figma frame layout grids (`ROWS`, `COLUMNS`, and `GRID`) retain their source size, count, alignment, offset, gutter, color, and bound variables. Select **Grid** in the canvas toolbar to show captured visible grids over the frozen screens. Figma's automatic row or column count is stored as `AUTO`, not as a fabricated fixed count.
- Figma does not have CSS margins. Handoff labels the edge distance from a layer to its immediate parent as a measured margin. The distance can be negative when layers overlap or extend outside the parent.
- The full raw paint data is retained in `sourcePayload`; the color summary shows a hex value for solid paints.
- A project spacing rule checks measured margins along with padding and layout gaps when the team configures an allowed spacing scale.
- The plugin captures Figma geometry and layout values without rounding. The inspector, comparison summaries, generated task-context descriptions, and copied CSS preserve the captured pixel values, including fractions. Measured distances retain the precision produced from the captured bounds. The frozen snapshot and structured MCP responses also keep the source values.

## Import validation and storage

Before creating a version, Handoff checks the snapshot schema, source tool, asset list, content types, file names, byte counts, per-file SHA-256 hashes, and the hash of the structured snapshot. A capture session can be finalized once. Handoff stores the accepted snapshot, pixel renders, and linked SVG sources as a new immutable version. Partial captures compose into a complete new version, and unchanged assets reuse their stored objects. Later captures create new versions that the app can compare.

The web app also accepts a source-agnostic structured ZIP package described in [snapshot-package.md](snapshot-package.md). Direct Paper MCP capture is deferred. A package can provide exact layout and token data when its exporter includes source geometry and bindings; image-only upload supports visual review but does not provide those properties.

## Capture limits

- There is no fixed artboard count limit. A capture can contain up to 50,000 layers.
- Render assets are limited to 256 MiB total. The plugin reserves part of this budget for the overview.
- Structured snapshot JSON is limited to 256 MiB (the Storage bucket's per-file limit) and uploads directly to Storage, so it does not pass through a Vercel Function request body.
- Individual layer exports are optional and capped at 256 files, 20 MiB total, and 5 MiB per asset. If Figma cannot export a vector layer as SVG, the plugin retries it as PNG. These limits do not remove layer properties or prevent the frame from being captured.
- A full-page capture includes top-level frames and components found under sections and groups. Loose page-level text, shapes, and notes outside those artboards are not included.
- Review the capture preview before uploading. If a full-file capture exceeds the layer or byte limits, reduce the content in the Figma file or capture selected frames.
