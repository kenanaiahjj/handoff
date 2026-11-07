# Snapshot package format

Use a ZIP package to upload structured design data from a source adapter. A package preserves the captured render, frame hierarchy, node geometry, layout values, token bindings, and source metadata as one immutable version.

## Package contents

Include these files in the ZIP:

```text
manifest.json
snapshot.json
overview.svg
frames/<frame-name>.svg
```

You can use `.png`, `.jpg`, `.jpeg`, `.webp`, or `.svg` for render assets. SVG assets cannot contain active content or external resource references. Use a path relative to the ZIP root for every `fileName` value in `snapshot.json`. Include each asset file once. The package cannot contain unrelated files or directory traversal paths.

The package can contain up to 100 MB of compressed data and up to 100 MB of expanded files. ZIP64 archives, encrypted archives, and compression methods other than Stored and Deflate are not supported.

## Manifest

Set `schemaVersion` to `1`, `source` to `bundle`, and `snapshotFile` to `snapshot.json`:

```json
{
  "schemaVersion": 1,
  "source": "bundle",
  "snapshotFile": "snapshot.json",
  "adapter": "figma-plugin",
  "adapterVersion": "0.1.0"
}
```

The importer preserves the manifest under `sourceMetadata.packageManifest`. Add source-specific metadata such as `sourceTool`, `sourceFileId`, and adapter version to `snapshot.json` so a review can show where the capture came from.

## Snapshot envelope

The `snapshot.json` file must match `snapshotEnvelopeSchema` from `@asbir/snapshot-contract`. Set `source` to `bundle` for package imports, even when an adapter captured the data from Figma or Paper. Record the originating tool in `sourceMetadata`.

Each measurement includes a value, unit, provenance, and source property. Use `source` when the design tool provided the value, `measured` for a deterministic distance calculated from captured geometry, and `unavailable` with a `null` value when the source did not provide a value.

```json
{
  "schemaVersion": 1,
  "source": "bundle",
  "sourceFileId": "source-file-id",
  "sourceRevisionId": "source-revision-id",
  "sourceFileName": "Checkout designs",
  "capturedAt": "2026-11-05T07:00:00.000Z",
  "contentHash": "<64 lowercase hexadecimal characters>",
  "overviewAssetKey": "overview",
  "canvasBounds": {
    "x": { "value": 0, "unit": "px", "provenance": "source", "sourceProperty": "canvasBounds.x" },
    "y": { "value": 0, "unit": "px", "provenance": "source", "sourceProperty": "canvasBounds.y" },
    "width": { "value": 1200, "unit": "px", "provenance": "source", "sourceProperty": "canvasBounds.width" },
    "height": { "value": 900, "unit": "px", "provenance": "source", "sourceProperty": "canvasBounds.height" }
  },
  "frames": [
    {
      "sourceFrameId": "frame-id",
      "sourcePageId": "page-id",
      "name": "Checkout / Mobile",
      "bounds": {
        "x": { "value": 0, "unit": "px", "provenance": "source", "sourceProperty": "absoluteBoundingBox.x" },
        "y": { "value": 0, "unit": "px", "provenance": "source", "sourceProperty": "absoluteBoundingBox.y" },
        "width": { "value": 390, "unit": "px", "provenance": "source", "sourceProperty": "absoluteBoundingBox.width" },
        "height": { "value": 844, "unit": "px", "provenance": "source", "sourceProperty": "absoluteBoundingBox.height" }
      },
      "renderAssetKey": "frame-checkout-mobile",
      "nodes": [
        {
          "sourceNodeId": "button-node-id",
          "parentSourceNodeId": "frame-id",
          "sourceFrameId": "frame-id",
          "name": "Continue button",
          "type": "FRAME",
          "visible": true,
          "bounds": {
            "x": { "value": 24, "unit": "px", "provenance": "source", "sourceProperty": "absoluteBoundingBox.x" },
            "y": { "value": 720, "unit": "px", "provenance": "source", "sourceProperty": "absoluteBoundingBox.y" },
            "width": { "value": 342, "unit": "px", "provenance": "source", "sourceProperty": "absoluteBoundingBox.width" },
            "height": { "value": 48, "unit": "px", "provenance": "source", "sourceProperty": "absoluteBoundingBox.height" }
          },
          "layout": {
            "mode": "HORIZONTAL",
            "direction": "LTR",
            "primaryAxisAlign": "CENTER",
            "counterAxisAlign": "CENTER",
            "wrap": false,
            "constraints": {}
          },
          "padding": {
            "top": { "value": 12, "unit": "px", "provenance": "source", "sourceProperty": "paddingTop" },
            "right": { "value": 16, "unit": "px", "provenance": "source", "sourceProperty": "paddingRight" },
            "bottom": { "value": 12, "unit": "px", "provenance": "source", "sourceProperty": "paddingBottom" },
            "left": { "value": 16, "unit": "px", "provenance": "source", "sourceProperty": "paddingLeft" }
          },
          "margins": {
            "top": { "value": null, "unit": "px", "provenance": "unavailable", "sourceProperty": null },
            "right": { "value": null, "unit": "px", "provenance": "unavailable", "sourceProperty": null },
            "bottom": { "value": null, "unit": "px", "provenance": "unavailable", "sourceProperty": null },
            "left": { "value": null, "unit": "px", "provenance": "unavailable", "sourceProperty": null }
          },
          "spacing": {
            "rowGap": { "value": null, "unit": "px", "provenance": "unavailable", "sourceProperty": null },
            "columnGap": { "value": null, "unit": "px", "provenance": "unavailable", "sourceProperty": null },
            "itemGap": { "value": null, "unit": "px", "provenance": "unavailable", "sourceProperty": null }
          },
          "fills": [
            {
              "color": "#3F7E36",
              "opacity": { "value": 1, "unit": "ratio", "provenance": "source", "sourceProperty": "fills[0].opacity" },
              "sourceStyleId": ""
            }
          ],
          "strokes": [],
          "styleReferences": [],
          "typography": null,
          "tokens": [],
          "sourcePayload": { "cornerRadius": 8 }
        }
      ]
    }
  ],
  "assets": [
    {
      "key": "overview",
      "fileName": "overview.png",
      "contentType": "image/png",
      "sizeBytes": 1000,
      "sha256": "<64 lowercase hexadecimal characters>",
      "width": 1200,
      "height": 900
    },
    {
      "key": "frame-checkout-mobile",
      "fileName": "frames/checkout-mobile.png",
      "contentType": "image/png",
      "sizeBytes": 2000,
      "sha256": "<64 lowercase hexadecimal characters>",
      "width": 780,
      "height": 1688
    }
  ],
  "sourceMetadata": {
    "sourceTool": "figma",
    "sourceFileId": "source-file-id",
    "sourceRevisionId": "source-revision-id"
  }
}
```

Replace the example identifiers, byte sizes, dimensions, and hashes with values from the captured files. `contentHash` is the SHA-256 hash returned by `hashSnapshotPayload` for the snapshot payload before `contentHash` is added. The importer verifies it and each asset hash before storing the version.

`canvasBounds` maps the overview render to source-canvas coordinates. Include it when the source adapter can report the complete captured canvas bounds. Without it, Handoff still preserves the overview image and exact per-frame data, but it does not draw element hit areas over the overview because their positions cannot be aligned reliably.

## Image-only uploads

You can upload a PNG, JPEG, or WebP file without a ZIP package. Handoff stores the image as a visual-only version with no node geometry, padding, margins, or token bindings. The interface labels those values as unavailable.
