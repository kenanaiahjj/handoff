/** Matches the Storage bucket's per-file limit; large Figma pages (Tripket 2.0.5 is ~130 MiB) exceed 128 MiB. */
export const MAX_SNAPSHOT_JSON_BYTES = 256 * 1024 * 1024;
export const MAX_CAPTURE_ASSET_BYTES = 256 * 1024 * 1024;
