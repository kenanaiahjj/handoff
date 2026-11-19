import { requireExactOrigin } from "./network-access.mjs";

export const TUS_THRESHOLD_BYTES = 6 * 1024 * 1024;
export const TUS_CHUNK_BYTES = 6 * 1024 * 1024;

export type UploadDescriptor = {
  assetKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
};

export type CaptureUploadIntent = {
  storageUrl: string;
  bucket: string;
  uploadProtocol?: "tus" | "direct";
  snapshot: { path: string; token: string };
  uploads: Array<{ assetKey: string; path: string; token: string }>;
};

export type SnapshotUploadAsset = {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  bytes: Uint8Array;
};

export type RenderUploadAsset = UploadDescriptor & { bytes: Uint8Array };

/** Snapshot JSON can be uploaded as is, or gzipped, which Storage keeps as an opaque binary file. */
export const SNAPSHOT_JSON_CONTENT_TYPE = "application/json";
export const SNAPSHOT_GZIP_CONTENT_TYPE = "application/octet-stream";

/**
 * Gzips the snapshot JSON before upload. Storage caps the size of a single file (50 MB on Supabase's
 * Free plan), and the structured JSON of a large Figma page can be bigger than that. Gzip is lossless and
 * usually shrinks it 8 to 15 times; the server unzips it before reading. Returns null where the browser
 * has no CompressionStream, so the caller can upload the plain JSON instead.
 */
export async function gzipSnapshotBytes(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export type UploadSessionState = {
  snapshotComplete: boolean;
  completedAssetKeys: Set<string>;
  resumableUrls: Map<string, string>;
  progressByUpload: Map<string, number>;
};

export type FinalizeManifest = {
  snapshotPath: string;
  assets: Record<string, string>;
  baselineVersionId: string | null;
  frameMatches: Array<{ beforeFrameId: string; afterFrameId: string }>;
  pageMode?: "add" | "replace";
};

type XhrFactory = () => XMLHttpRequest;

type RequestOptions = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Uint8Array;
  signal?: AbortSignal;
  xhrFactory: XhrFactory;
  onProgress?: (loaded: number) => void;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertDescriptor(value: UploadDescriptor) {
  if (!value.assetKey || !value.fileName || !value.contentType) throw new Error("Every render upload needs an asset key, file name, and content type.");
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 0) throw new Error(`The size for ${value.assetKey} is invalid.`);
  if (!/^[a-f0-9]{64}$/i.test(value.sha256)) throw new Error(`The SHA-256 for ${value.assetKey} is invalid.`);
}

function assertSnapshotDescriptor(value: Omit<SnapshotUploadAsset, "bytes">) {
  if (!value.fileName || (value.contentType !== SNAPSHOT_JSON_CONTENT_TYPE && value.contentType !== SNAPSHOT_GZIP_CONTENT_TYPE)) {
    throw new Error("The snapshot upload must be JSON or gzipped JSON.");
  }
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 0) throw new Error("The snapshot size is invalid.");
  if (!/^[a-f0-9]{64}$/i.test(value.sha256)) throw new Error("The snapshot SHA-256 is invalid.");
}

function assertPath(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{48}$/.test(value)) {
    throw new Error("The upload intent returned an invalid object path.");
  }
  return value;
}

function assertToken(value: unknown) {
  if (typeof value !== "string" || value.length < 1) throw new Error("The upload intent returned a missing signed upload token.");
  return value;
}

function validateIntent(value: unknown, expectedStorageOrigin: string, descriptors: UploadDescriptor[]) {
  if (!record(value) || typeof value.storageUrl !== "string" || typeof value.bucket !== "string" || !Array.isArray(value.uploads) || !record(value.snapshot)) {
    throw new Error("The upload intent response is incomplete.");
  }
  const storageUrl = requireExactOrigin(value.storageUrl, expectedStorageOrigin);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(value.bucket)) throw new Error("The upload intent returned an invalid bucket name.");
  if (value.uploadProtocol !== undefined && value.uploadProtocol !== "tus" && value.uploadProtocol !== "direct") {
    throw new Error("The upload intent returned an invalid upload protocol.");
  }

  const snapshot = {
    path: assertPath(value.snapshot.path),
    token: assertToken(value.snapshot.token),
  };
  if (value.uploads.length !== descriptors.length) throw new Error("The upload intent did not match the declared assets.");
  const expectedKeys = new Set(descriptors.map((asset) => asset.assetKey));
  if (expectedKeys.size !== descriptors.length) throw new Error("The capture declares duplicate asset keys.");
  const uploads = value.uploads.map((rawUpload) => {
    if (!record(rawUpload) || typeof rawUpload.assetKey !== "string") throw new Error("The upload intent returned an invalid asset declaration.");
    if (!expectedKeys.has(rawUpload.assetKey)) throw new Error("The upload intent returned an unexpected asset key.");
    expectedKeys.delete(rawUpload.assetKey);
    return {
      assetKey: rawUpload.assetKey,
      path: assertPath(rawUpload.path),
      token: assertToken(rawUpload.token),
    };
  });
  if (expectedKeys.size) throw new Error("The upload intent omitted one or more declared assets.");
  const paths = [snapshot.path, ...uploads.map((upload) => upload.path)];
  if (new Set(paths).size !== paths.length) throw new Error("The upload intent reused an object path.");
  return {
    storageUrl,
    bucket: value.bucket,
    uploadProtocol: value.uploadProtocol === "direct" ? "direct" : "tus",
    snapshot,
    uploads,
  } satisfies CaptureUploadIntent;
}

export async function requestCaptureUploadIntent(input: {
  handoffOrigin: string;
  expectedStorageOrigin: string;
  token: string;
  snapshot: { sizeBytes: number; sha256: string; encoding?: "gzip" };
  assets: UploadDescriptor[];
  renew?: boolean;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<CaptureUploadIntent> {
  const fetcher = input.fetcher ?? fetch;
  const requestUrl = new URL("/api/capture-sessions/uploads", input.handoffOrigin);
  const snapshot = {
    sizeBytes: input.snapshot.sizeBytes,
    sha256: input.snapshot.sha256,
    ...(input.snapshot.encoding === "gzip" ? { encoding: "gzip" as const } : {}),
  };
  assertSnapshotDescriptor({
    sizeBytes: snapshot.sizeBytes,
    sha256: snapshot.sha256,
    fileName: snapshot.encoding === "gzip" ? "snapshot.json.gz" : "snapshot.json",
    contentType: snapshot.encoding === "gzip" ? SNAPSHOT_GZIP_CONTENT_TYPE : SNAPSHOT_JSON_CONTENT_TYPE,
  });
  input.assets.forEach(assertDescriptor);
  const requestInit: RequestInit = {
    method: "POST",
    headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      snapshot,
      assets: input.assets.map(({ assetKey, fileName, contentType, sizeBytes, sha256 }) => ({ assetKey, fileName, contentType, sizeBytes, sha256 })),
      ...(input.renew ? { renew: true } : {}),
    }),
    mode: "cors",
    credentials: "omit",
    redirect: "error",
    signal: input.signal,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetcher(requestUrl, requestInit);
    const body = await response.json().catch(() => ({})) as unknown;
    if (response.status === 401 && record(body) && body.code === "capture_token_expired" && attempt === 0) {
      await renewCaptureSession({ handoffOrigin: input.handoffOrigin, token: input.token, signal: input.signal, fetcher });
      continue;
    }
    if (!response.ok) {
      const error = record(body) && typeof body.error === "string" ? body.error : `Upload preparation failed with status ${response.status}.`;
      throw Object.assign(new Error(error), { status: response.status, code: record(body) ? body.code : undefined });
    }
    return validateIntent(body, input.expectedStorageOrigin, input.assets);
  }
  throw new Error("Upload preparation failed after renewing the capture session.");
}

export async function renewCaptureSession(input: {
  handoffOrigin: string;
  token: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}) {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(new URL("/api/capture-sessions/renew", input.handoffOrigin), {
    method: "POST",
    headers: { Authorization: `Bearer ${input.token}` },
    mode: "cors",
    credentials: "omit",
    redirect: "error",
    signal: input.signal,
  });
  const body = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) {
    const error = record(body) && typeof body.error === "string" ? body.error : `Capture session renewal failed with status ${response.status}.`;
    throw new Error(error);
  }
}

export function buildFinalizeManifest(input: FinalizeManifest): FinalizeManifest {
  return {
    snapshotPath: assertPath(input.snapshotPath),
    assets: Object.fromEntries(Object.entries(input.assets).map(([assetKey, path]) => {
      if (!assetKey) throw new Error("The finalize manifest contains an empty asset key.");
      return [assetKey, assertPath(path)];
    })),
    baselineVersionId: input.baselineVersionId,
    frameMatches: input.frameMatches,
    ...(input.pageMode ? { pageMode: input.pageMode } : {}),
  };
}

export function createUploadSessionState(): UploadSessionState {
  return {
    snapshotComplete: false,
    completedAssetKeys: new Set(),
    resumableUrls: new Map(),
    progressByUpload: new Map(),
  };
}

function xhrRequest(options: RequestOptions) {
  return new Promise<XMLHttpRequest>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("Upload canceled."));
      return;
    }
    const xhr = options.xhrFactory();
    const cleanup = () => options.signal?.removeEventListener("abort", abort);
    const abort = () => xhr.abort();
    xhr.open(options.method, options.url, true);
    for (const [name, value] of Object.entries(options.headers)) xhr.setRequestHeader(name, value);
    if (options.onProgress) {
      xhr.upload.onprogress = (event) => options.onProgress?.(event.loaded);
    }
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr);
      else reject(Object.assign(new Error(xhr.responseText || `Storage upload failed with status ${xhr.status}.`), { status: xhr.status }));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error("Storage upload failed because the network connection was interrupted."));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new Error("Upload canceled."));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const body = options.body
      ? options.body.buffer.slice(options.body.byteOffset, options.body.byteOffset + options.body.byteLength) as ArrayBuffer
      : null;
    xhr.send(body);
  });
}

function encodeMetadata(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function tusMetadata(bucket: string, path: string, contentType: string) {
  return [
    ["bucketName", bucket],
    ["objectName", path],
    ["contentType", contentType],
    ["cacheControl", "3600"],
  ].map(([key, value]) => `${key} ${encodeMetadata(value)}`).join(",");
}

function signedUploadUrl(intent: CaptureUploadIntent, path: string, token: string) {
  const pathSegments = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const url = new URL(`${intent.storageUrl}/storage/v1/object/upload/sign/${encodeURIComponent(intent.bucket)}/${pathSegments}`);
  url.searchParams.set("token", token);
  return url.toString();
}

function alreadyExists(error: unknown) {
  const candidate = error as { status?: number; message?: string };
  return (candidate.status === 409 || candidate.status === 400) && /already exists|resource already exists/i.test(candidate.message ?? "");
}

async function uploadSmallAsset(input: {
  intent: CaptureUploadIntent;
  path: string;
  token: string;
  asset: SnapshotUploadAsset | RenderUploadAsset;
  signal?: AbortSignal;
  xhrFactory: XhrFactory;
  onProgress?: (loaded: number) => void;
}) {
  try {
    await xhrRequest({
      method: "PUT",
      url: signedUploadUrl(input.intent, input.path, input.token),
      headers: { "Content-Type": input.asset.contentType },
      body: input.asset.bytes,
      signal: input.signal,
      xhrFactory: input.xhrFactory,
      onProgress: input.onProgress,
    });
  } catch (error) {
    if (!alreadyExists(error)) throw error;
  }
}

function assertStorageUploadUrl(value: string, expectedStorageOrigin: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Supabase returned an invalid resumable upload URL.");
  }
  requireExactOrigin(url.origin, expectedStorageOrigin);
  return url.toString();
}

async function uploadTusAsset(input: {
  intent: CaptureUploadIntent;
  path: string;
  token: string;
  asset: SnapshotUploadAsset | RenderUploadAsset;
  stateKey: string;
  expectedStorageOrigin: string;
  session: UploadSessionState;
  signal?: AbortSignal;
  xhrFactory: XhrFactory;
  onProgress?: (loaded: number) => void;
}) {
  let uploadUrl = input.session.resumableUrls.get(input.stateKey);
  if (!uploadUrl) {
    const endpoint = `${input.intent.storageUrl}/storage/v1/upload/resumable/sign`;
    const created = await xhrRequest({
      method: "POST",
      url: endpoint,
      headers: {
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(input.asset.sizeBytes),
        "Upload-Metadata": tusMetadata(input.intent.bucket, input.path, input.asset.contentType),
        "x-signature": input.token,
      },
      signal: input.signal,
      xhrFactory: input.xhrFactory,
    });
    const location = created.getResponseHeader("Location");
    if (!location) throw new Error("Supabase did not return a resumable upload URL.");
    uploadUrl = assertStorageUploadUrl(new URL(location, endpoint).toString(), input.expectedStorageOrigin);
    input.session.resumableUrls.set(input.stateKey, uploadUrl);
  }

  let head: XMLHttpRequest;
  try {
    head = await xhrRequest({
      method: "HEAD",
      url: uploadUrl,
      headers: { "Tus-Resumable": "1.0.0", "x-signature": input.token },
      signal: input.signal,
      xhrFactory: input.xhrFactory,
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404 || status === 410) return;
    throw error;
  }

  const offsetValue = head.getResponseHeader("Upload-Offset");
  let offset = Number(offsetValue);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > input.asset.sizeBytes) {
    throw new Error("Supabase returned an invalid TUS upload offset.");
  }
  input.onProgress?.(offset);
  while (offset < input.asset.sizeBytes) {
    const end = Math.min(offset + TUS_CHUNK_BYTES, input.asset.sizeBytes);
    const chunk = input.asset.bytes.subarray(offset, end);
    const beforeChunk = offset;
    const response = await xhrRequest({
      method: "PATCH",
      url: uploadUrl,
      headers: {
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": String(offset),
        "Content-Type": "application/offset+octet-stream",
        "x-signature": input.token,
      },
      body: chunk,
      signal: input.signal,
      xhrFactory: input.xhrFactory,
      onProgress: (loaded) => input.onProgress?.(Math.min(input.asset.sizeBytes, beforeChunk + loaded)),
    });
    const nextOffset = Number(response.getResponseHeader("Upload-Offset") ?? end);
    if (!Number.isSafeInteger(nextOffset) || nextOffset !== end) {
      throw new Error("Supabase returned an unexpected TUS upload offset.");
    }
    offset = nextOffset;
    input.onProgress?.(offset);
  }
}

/** Waits before retrying a file whose upload hit a passing network or Storage problem. */
const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000, 8_000];
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function isTransientUploadError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return false;
  const candidate = error as { status?: number; message?: string };
  if (/canceled/i.test(candidate?.message ?? "")) return false;
  // A dropped connection has no status; Storage overload and gateway errors are worth another try.
  return candidate?.status === undefined ? /network connection was interrupted/i.test(candidate?.message ?? "") : TRANSIENT_STATUSES.has(candidate.status);
}

function waitBeforeRetry(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Upload canceled."));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Upload canceled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * One capture uploads hundreds of files, so a single dropped request should not fail it. Each file is
 * retried on transient errors; resumable uploads continue from Storage's offset, and a small upload that
 * actually landed is accepted as "already exists".
 */
async function withUploadRetries<T>(upload: () => Promise<T>, delays: readonly number[], signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await upload();
    } catch (error) {
      if (attempt >= delays.length || !isTransientUploadError(error, signal)) throw error;
      await waitBeforeRetry(delays[attempt], signal);
    }
  }
}

export async function uploadCaptureAssets(input: {
  intent: CaptureUploadIntent;
  snapshotAsset: SnapshotUploadAsset;
  assets: RenderUploadAsset[];
  expectedStorageOrigin: string;
  session: UploadSessionState;
  signal?: AbortSignal;
  xhrFactory?: XhrFactory;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  /** Delays between retries of one file; tests pass zeros. */
  retryDelaysMs?: readonly number[];
}): Promise<{ snapshotPath: string; assets: Record<string, string> }> {
  const intent = validateIntent(input.intent, input.expectedStorageOrigin, input.assets);
  assertSnapshotDescriptor(input.snapshotAsset);
  if (input.snapshotAsset.bytes.byteLength !== input.snapshotAsset.sizeBytes) throw new Error("The snapshot byte count does not match its upload descriptor.");
  const xhrFactory = input.xhrFactory ?? (() => new XMLHttpRequest());
  input.assets.forEach((asset) => {
    assertDescriptor(asset);
    if (asset.bytes.byteLength !== asset.sizeBytes) throw new Error(`The byte count for ${asset.assetKey} does not match its upload descriptor.`);
  });
  const totalBytes = input.snapshotAsset.sizeBytes + input.assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);
  const snapshotKey = "@snapshot";
  const snapshotUpload = { ...input.snapshotAsset, assetKey: snapshotKey };
  const uploadRows = [
    { key: snapshotKey, path: intent.snapshot.path, token: intent.snapshot.token, asset: snapshotUpload, completed: input.session.snapshotComplete },
    ...input.assets.map((asset) => {
      const signed = intent.uploads.find((upload) => upload.assetKey === asset.assetKey)!;
      return { key: asset.assetKey, path: signed.path, token: signed.token, asset, completed: input.session.completedAssetKeys.has(asset.assetKey) };
    }),
  ];
  const reportProgress = (key: string, value: number) => {
    input.session.progressByUpload.set(key, Math.min(Math.max(value, 0), uploadRows.find((row) => row.key === key)!.asset.sizeBytes));
    const uploadedBytes = uploadRows.reduce((sum, row) => sum + (row.completed ? row.asset.sizeBytes : input.session.progressByUpload.get(row.key) ?? 0), 0);
    input.onProgress?.(uploadedBytes, totalBytes);
  };
  for (const row of uploadRows) {
    try {
      await uploadRow(row);
    } catch (error) {
      throw explainStorageRejection(error, row.asset);
    }
  }
  return {
    snapshotPath: intent.snapshot.path,
    assets: Object.fromEntries(intent.uploads.map(({ assetKey, path }) => [assetKey, path])),
  };

  async function uploadRow(row: (typeof uploadRows)[number]) {
    if (row.completed) {
      reportProgress(row.key, row.asset.sizeBytes);
      return;
    }
    const progress = (loaded: number) => reportProgress(row.key, loaded);
    const retryDelays = input.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    if (intent.uploadProtocol !== "direct" && row.asset.sizeBytes > TUS_THRESHOLD_BYTES) {
      await withUploadRetries(() => uploadTusAsset({
        intent,
        path: row.path,
        token: row.token,
        asset: row.asset,
        stateKey: row.key,
        expectedStorageOrigin: input.expectedStorageOrigin,
        session: input.session,
        signal: input.signal,
        xhrFactory,
        onProgress: progress,
      }), retryDelays, input.signal);
    } else {
      await withUploadRetries(() => uploadSmallAsset({
        intent,
        path: row.path,
        token: row.token,
        asset: row.asset,
        signal: input.signal,
        xhrFactory,
        onProgress: progress,
      }), retryDelays, input.signal);
    }
    reportProgress(row.key, row.asset.sizeBytes);
    if (row.key === snapshotKey) input.session.snapshotComplete = true;
    else input.session.completedAssetKeys.add(row.key);
  }
}

/** Turns Storage's bare "413" into a message that names the file and says what to change. */
export function explainStorageRejection(error: unknown, asset: { fileName: string; sizeBytes: number }) {
  const status = (error as { status?: number })?.status;
  const message = (error as { message?: string })?.message ?? "";
  if (status !== 413 && !/maximum (allowed )?size|payload too large|exceeded the maximum/i.test(message)) return error;
  const megabytes = (asset.sizeBytes / (1024 * 1024)).toFixed(1);
  return Object.assign(new Error(
    `Storage refused ${asset.fileName} (${megabytes} MB) because it is larger than the Supabase project's per-file upload limit. ` +
    "Raise the limit in Supabase (Project Settings → Storage, and the handoff-assets bucket), or capture fewer frames at once.",
  ), { status: 413, cause: error });
}
