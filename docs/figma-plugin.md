# Figma capture plugin

The Asbir Handoff Capture plugin freezes selected Figma frames into a versioned handoff. It captures rendered images and structured design data, including layer bounds, auto-layout padding and gaps, paints, text styles, and bound variables.

## Requirements

- Figma Desktop
- Node.js `22.23.1` and npm `10`
- A running Asbir Handoff workspace

## Build for local development

From the repository root, install the workspace dependencies and build the plugin:

```sh
npm ci
npm run build --workspace @asbir/figma-plugin
```

The default server is `http://localhost:3000`. The build creates `integrations/figma-plugin/manifest.json` and the bundled files in `integrations/figma-plugin/dist/`. These generated files are ignored by Git because the manifest is specific to the server URL used at build time.

In Figma Desktop, select **Plugins → Development → Import plugin from manifest…** and choose `integrations/figma-plugin/manifest.json`. The plugin appears under **Plugins → Development → Asbir Handoff Capture**.

## Build for a hosted server

Use the deployed HTTPS origin when building the plugin. This generates a manifest that only allows the capture endpoint on that host.

macOS or Linux:

```sh
HANDOFF_PUBLIC_URL=https://your-handoff-domain.example npm run build --workspace @asbir/figma-plugin
```

Windows PowerShell:

```powershell
$env:HANDOFF_PUBLIC_URL = "https://your-handoff-domain.example"
npm run build --workspace @asbir/figma-plugin
```

The plugin manifest grants access to the exact capture endpoint. Figma blocks plugin requests to domains that are not listed in `networkAccess.allowedDomains`; see [Figma's plugin manifest documentation](https://developers.figma.com/docs/plugins/manifest/).

## Capture a version

1. Sign in to Asbir Handoff and open the project where the snapshot belongs.
2. Create a Figma capture session. Copy its one-time token before it expires in one hour.
3. Open the Figma file and page that contain the frames.
4. Run **Plugins → Development → Asbir Handoff Capture**.
5. Confirm the Handoff server, then paste the capture token.
6. Choose selected frames, all top-level frames and components on the current page, or the entire Figma file across all pages.
7. Capture the canvas, review the overview image, page count, and layer count, then upload the immutable version.

The plugin does not change the Figma document. Each upload creates a new immutable version in Asbir Handoff. For an existing handoff, selected-frame captures update only the captured frames and keep the other frames, layers, and assets. A page capture replaces that page’s frames and keeps the other pages. A full-file capture replaces the complete canvas. When Figma gives a replacement frame a new ID, review and confirm its suggested frame-name match before upload so the partial capture replaces the intended frame. After upload, version comparison automatically pairs exact screen names that are unique in both captures when the verified Figma file ID matches.

## Troubleshooting

- **The plugin cannot reach Handoff:** rebuild with the correct `HANDOFF_PUBLIC_URL`. The hostname must match the Handoff server and use HTTPS outside local development.
- **The token is rejected:** create a new capture session and use its current token.
- **No frames are captured:** select at least one supported frame, or switch to the page that contains the frames before choosing the all-frames option.
- **The image has no layer-level layout values:** use the structured Figma capture; a flat image upload cannot provide exact layer geometry or bound token data.
