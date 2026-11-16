/**
 * Stored images are content-addressed (their key is derived from their bytes), so a given URL
 * never changes. Browsers may keep them for a year; "private" keeps shared caches and CDNs out,
 * since access is still checked on every request that reaches the server.
 */
export const immutableAssetCacheControl = "private, max-age=31536000, immutable";

export function assetEtag(sha256: string) {
  return `"${sha256}"`;
}

/** A 304 when the browser already holds this exact image, so the server skips reading and hashing it. */
export function notModifiedResponse(request: Request, sha256: string) {
  const ifNoneMatch = request.headers.get("if-none-match");
  if (!ifNoneMatch) return null;
  const etag = assetEtag(sha256);
  const matches = ifNoneMatch.split(",").some((candidate) => candidate.trim().replace(/^W\//, "") === etag);
  return matches ? new Response(null, { status: 304, headers: { "Cache-Control": immutableAssetCacheControl, ETag: etag } }) : null;
}
