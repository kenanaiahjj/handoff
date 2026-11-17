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
  if (!value.fileName || value.contentType !== "application/json") throw new Error("The snapshot upload must be JSON.");
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
  snapshot: { sizeBytes: number; sha256: string };
  assets: UploadDescriptor[];
  renew?: boolean;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<CaptureUploadIntent> {
  const fetcher = input.fetcher ?? fetch;
  const requestUrl = new URL("/api/capture-sessions/uploads", input.handoffOrigin);
  const snapshot = { sizeBytes: input.snapshot.sizeBytes, sha256: input.snapshot.sha256 };
  assertSnapshotDescriptor({ ...snapshot, fileName: "snapshot.json", contentType: "application/json" });
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
    const endpoint = `${input.intent.storageUrl}/storage/v1/upload/resumable`;
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

export async function uploadCaptureAssets(input: {
  intent: CaptureUploadIntent;
  snapshotAsset: SnapshotUploadAsset;
  assets: RenderUploadAsset[];
  expectedStorageOrigin: string;
  session: UploadSessionState;
  signal?: AbortSignal;
  xhrFactory?: XhrFactory;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
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
    if (row.completed) {
      reportProgress(row.key, row.asset.sizeBytes);
      continue;
    }
    const progress = (loaded: number) => reportProgress(row.key, loaded);
    if (intent.uploadProtocol !== "direct" && row.asset.sizeBytes > TUS_THRESHOLD_BYTES) {
      await uploadTusAsset({
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
      });
    } else {
      await uploadSmallAsset({
        intent,
        path: row.path,
        token: row.token,
        asset: row.asset,
        signal: input.signal,
        xhrFactory,
        onProgress: progress,
      });
    }
    reportProgress(row.key, row.asset.sizeBytes);
    if (row.key === snapshotKey) input.session.snapshotComplete = true;
    else input.session.completedAssetKeys.add(row.key);
  }
  return {
    snapshotPath: intent.snapshot.path,
    assets: Object.fromEntries(intent.uploads.map(({ assetKey, path }) => [assetKey, path])),
  };
}
