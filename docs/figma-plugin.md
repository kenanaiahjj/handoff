# Figma capture plugin

The Asbir Handoff Capture plugin freezes selected Figma frames into a versioned handoff. It captures rendered images and structured design data, including layer bounds, auto-layout padding and gaps, paints, text styles, and bound variables.

## Requirements

- Figma Desktop
- Node.js `22.23.1` and npm `10`
- A running Asbir Handoff workspace

## Build for local development

Start the app with `npm run dev`, then build the plugin for the local signed-upload endpoint:

```sh
npm run plugin:build:local
```

The local server and upload endpoint both use `http://localhost:3000`. The build creates `integrations/figma-plugin/manifest.json` and bundled files in `integrations/figma-plugin/dist/`. These generated files are ignored by Git because the manifest is specific to the server and Storage URLs used at build time. Local mode uses signed direct uploads; the Supabase build continues to use resumable TUS uploads for large files.

After changing plugin source files, run the build again. Figma loads the generated files from `dist/`, not the source files. Close the running plugin and launch **Plugins → Development → Asbir Handoff Capture** again to load the rebuilt bundle.

In Figma Desktop, select **Plugins → Development → Import plugin from manifest…** and choose `integrations/figma-plugin/manifest.json`. The plugin appears under **Plugins → Development → Asbir Handoff Capture**.

## Build for a hosted server

Use the deployed HTTPS origins when building the plugin. The generated manifest allows only the Handoff capture routes and the exact Supabase Storage host.

macOS or Linux:

```sh
HANDOFF_PUBLIC_URL=https://your-handoff-domain.example SUPABASE_URL=https://your-project-ref.supabase.co npm run build --workspace @asbir/figma-plugin
```

Windows PowerShell:

```powershell
$env:HANDOFF_PUBLIC_URL = "https://your-handoff-domain.example"
$env:SUPABASE_URL = "https://your-project-ref.supabase.co"
npm run build --workspace @asbir/figma-plugin
```

The plugin manifest grants access to the capture routes under `/api/capture-sessions/` and to the configured Supabase Storage host. `SUPABASE_URL` is used at build time to derive the Storage origin. The plugin bundle contains no Supabase API key or service-role key. Build it for production with both `HANDOFF_PUBLIC_URL` and `SUPABASE_URL` set. Figma blocks plugin requests to domains that are not listed in `networkAccess.allowedDomains`; see [Figma's plugin manifest documentation](https://developers.figma.com/docs/plugins/manifest/).

## Capture a version

1. Sign in to Asbir Handoff and open the project where the snapshot belongs.
2. Create a Figma capture session. Copy its one-time token before it expires in one hour.
3. Open the Figma file and page that contain the frames.
4. Run **Plugins → Development → Asbir Handoff Capture**.
5. Confirm the Handoff server, then paste the capture token.
6. Choose selected frames, all top-level frames and components on the current page, or the entire Figma file across all pages.
7. Capture the canvas and review the overview image, page count, and layer count.
8. Upload the immutable version. The plugin stages the snapshot JSON and render assets in private Supabase Storage, then sends Handoff a small manifest with the staged paths.

The plugin does not change the Figma document. Each successful finalization creates one immutable version in Asbir Handoff. A retry reuses the captured snapshot and staged paths, so it does not create another version. Blank or duplicate screen names trigger a warning but do not block upload; those screens might not match by name across versions. For an existing handoff, selected-frame captures update only the captured frames and keep the other frames, layers, and assets. A page capture replaces that page’s frames and keeps the other pages. A full-file capture replaces the complete canvas. When Figma gives a replacement frame a new ID, review and confirm its suggested frame-name match before upload so the partial capture replaces the intended frame. After upload, version comparison automatically pairs exact screen names that are unique in both captures when the verified Figma file ID matches.

The plugin requests one-time signed upload tokens for the snapshot and each render. Files up to 6 MiB use Supabase’s signed upload route. Larger files use TUS resumable uploads with 6 MiB chunks. The plugin shows upload progress and lets you cancel. If a transfer is interrupted, retry resumes a TUS upload or reuses the same small-file path. If Handoff reports a size, content-type, or checksum mismatch, the plugin requests fresh scoped paths and resends the already-captured bytes. If the one-hour capture token expires after an upload started, the plugin renews the active session before retrying. The capture token is consumed only when Handoff finalizes the version.

## Troubleshooting

- **The plugin cannot reach Handoff:** rebuild with the correct `HANDOFF_PUBLIC_URL`. The hostname must match the Handoff server and use HTTPS outside local development.
- **The plugin cannot reach Storage:** rebuild with the correct `SUPABASE_URL` and confirm that the generated manifest lists that project’s Storage host.
- **The token is rejected:** create a new capture session and use its current token.
- **No frames are captured:** select at least one supported frame, or switch to the page that contains the frames before choosing the all-frames option.
- **The image has no layer-level layout values:** use the structured Figma capture; a flat image upload cannot provide exact layer geometry or bound token data.
