import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFinalizeManifest,
  createUploadSessionState,
  requestCaptureUploadIntent,
  uploadCaptureAssets,
} from "../src/storage-upload.ts";

const storageUrl = "https://project-ref.storage.supabase.co";
const bucket = "handoff-assets";
const snapshotPath = "a".repeat(48);
const renderPath = "b".repeat(48);

function makeResponse(body, { ok = true, status = ok ? 200 : 400 } = {}) {
  return { ok, status, json: async () => body };
}

function FakeXHRFactory(responses = {}) {
  const requests = [];
  const xhrFactory = () => {
    const xhr = {
      headers: {},
      upload: {},
      responseHeaders: {},
      status: 0,
      responseText: "",
      open(method, url) { this.method = method; this.url = url; },
      setRequestHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      getResponseHeader(name) { return this.responseHeaders[name.toLowerCase()] ?? null; },
      send(body) {
        this.body = body;
        requests.push(this);
        const response = responses[this.method]?.(this) ?? {};
        queueMicrotask(() => {
          if (response.error) {
            this.onerror?.();
            return;
          }
          this.status = response.status ?? (this.method === "POST" ? 201 : this.method === "HEAD" ? 204 : 200);
          this.responseText = response.responseText ?? "";
          this.responseHeaders = Object.fromEntries(Object.entries(response.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
          if (body && this.upload.onprogress) this.upload.onprogress({ loaded: body.byteLength, lengthComputable: true, total: body.byteLength });
          this.onload?.();
        });
      },
      abort() { this.onabort?.(); },
    };
    return xhr;
  };
  return { xhrFactory, requests };
}

test("requests an upload intent with JSON metadata only", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    return makeResponse({
      storageUrl,
      bucket,
      snapshot: { path: snapshotPath, token: "signed-snapshot-token" },
      uploads: [{ assetKey: "overview", path: renderPath, token: "signed-render-token" }],
    });
  };
  const snapshot = { sizeBytes: 120, sha256: "1".repeat(64) };
  const assets = [{ assetKey: "overview", fileName: "overview.png", contentType: "image/png", sizeBytes: 5, sha256: "2".repeat(64) }];

  const intent = await requestCaptureUploadIntent({
    handoffOrigin: "https://handoff.example.com",
    expectedStorageOrigin: storageUrl,
    token: "capture-token",
    snapshot,
    assets,
    fetcher,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://handoff.example.com/api/capture-sessions/uploads");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer capture-token");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), { snapshot, assets });
  assert.equal(calls[0].init.body.includes("signed-snapshot-token"), false);
  assert.equal(intent.storageUrl, storageUrl);
});

test("renews staged paths without adding snapshot or render bytes to the request", async () => {
  let requestBody;
  await requestCaptureUploadIntent({
    handoffOrigin: "https://handoff.example.com",
    expectedStorageOrigin: storageUrl,
    token: "capture-token",
    snapshot: { sizeBytes: 120, sha256: "1".repeat(64) },
    assets: [],
    renew: true,
    fetcher: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return makeResponse({ storageUrl, bucket, snapshot: { path: snapshotPath, token: "snapshot-token" }, uploads: [] });
    },
  });

  assert.deepEqual(requestBody, { snapshot: { sizeBytes: 120, sha256: "1".repeat(64) }, assets: [], renew: true });
});

test("renews an active capture session before retrying an expired upload intent", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    const requestUrl = String(url);
    calls.push({ url: requestUrl, init });
    if (requestUrl.endsWith("/api/capture-sessions/renew")) return makeResponse({ expiresAt: "2026-11-18T00:00:00.000Z" });
    if (calls.filter((call) => call.url.endsWith("/api/capture-sessions/uploads")).length === 1) {
      return makeResponse({ code: "capture_token_expired", error: "The capture session expired." }, { ok: false, status: 401 });
    }
    return makeResponse({
      storageUrl,
      bucket,
      snapshot: { path: snapshotPath, token: "signed-snapshot-token" },
      uploads: [{ assetKey: "overview", path: renderPath, token: "signed-render-token" }],
    });
  };

  await requestCaptureUploadIntent({
    handoffOrigin: "https://handoff.example.com",
    expectedStorageOrigin: storageUrl,
    token: "capture-token",
    snapshot: { sizeBytes: 120, sha256: "1".repeat(64) },
    assets: [{ assetKey: "overview", fileName: "overview.png", contentType: "image/png", sizeBytes: 5, sha256: "2".repeat(64) }],
    fetcher,
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, "https://handoff.example.com/api/capture-sessions/renew");
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.headers.Authorization, "Bearer capture-token");
  assert.equal(calls[1].init.body, undefined);
  assert.equal(calls[1].init.headers["Content-Type"], undefined);
  assert.equal(calls[2].url, calls[0].url);
});

test("rejects upload intents with an unexpected host, missing keys, or unsafe object paths", async () => {
  for (const responseBody of [
    { storageUrl: "https://attacker.example", bucket, snapshot: { path: snapshotPath, token: "s" }, uploads: [{ assetKey: "overview", path: renderPath, token: "r" }] },
    { storageUrl, bucket, snapshot: { path: snapshotPath, token: "s" }, uploads: [] },
    { storageUrl, bucket, snapshot: { path: "../escape", token: "s" }, uploads: [{ assetKey: "overview", path: renderPath, token: "r" }] },
  ]) {
    await assert.rejects(() => requestCaptureUploadIntent({
      handoffOrigin: "https://handoff.example.com",
      expectedStorageOrigin: storageUrl,
      token: "capture-token",
      snapshot: { sizeBytes: 120, sha256: "1".repeat(64) },
      assets: [{ assetKey: "overview", fileName: "overview.png", contentType: "image/png", sizeBytes: 5, sha256: "2".repeat(64) }],
      fetcher: async () => makeResponse(responseBody),
    }));
  }
});

test("sends small payloads as signed PUTs and large payloads through signed TUS chunks", async () => {
  const largeSize = 6 * 1024 * 1024 + 1;
  const snapshotAsset = { fileName: "snapshot.json", contentType: "application/json", sizeBytes: 3, sha256: "3".repeat(64), bytes: new Uint8Array([1, 2, 3]) };
  const assets = [
    { assetKey: "overview", fileName: "overview.png", contentType: "image/png", sizeBytes: 3, sha256: "4".repeat(64), bytes: new Uint8Array([4, 5, 6]) },
    { assetKey: "frame-1", fileName: "frame.png", contentType: "image/png", sizeBytes: largeSize, sha256: "5".repeat(64), bytes: new Uint8Array(largeSize) },
  ];
  const intent = {
    storageUrl,
    bucket,
    snapshot: { path: snapshotPath, token: "snapshot-signature" },
    uploads: [
      { assetKey: "overview", path: renderPath, token: "overview-signature" },
      { assetKey: "frame-1", path: "c".repeat(48), token: "frame-signature" },
    ],
  };
  const fake = FakeXHRFactory({
    POST: () => ({ status: 201, headers: { Location: "/storage/v1/upload/resumable/session-1" } }),
    HEAD: () => ({ status: 204, headers: { "Upload-Offset": "0" } }),
    PATCH: (xhr) => ({ status: 204, headers: { "Upload-Offset": String(Number(xhr.headers["upload-offset"]) + xhr.body.byteLength) } }),
  });
  const session = createUploadSessionState();
  const progress = [];

  const result = await uploadCaptureAssets({
    intent,
    snapshotAsset,
    assets,
    expectedStorageOrigin: storageUrl,
    session,
    xhrFactory: fake.xhrFactory,
    onProgress: (uploaded, total) => progress.push([uploaded, total]),
  });

  assert.deepEqual(result, { snapshotPath, assets: { overview: renderPath, "frame-1": "c".repeat(48) } });
  const smallPut = fake.requests.find((request) => request.method === "PUT" && request.url.includes(renderPath));
  assert.ok(smallPut.url.startsWith(`${storageUrl}/storage/v1/object/upload/sign/${bucket}/`));
  assert.equal(new URL(smallPut.url).searchParams.get("token"), "overview-signature");
  assert.equal(smallPut.headers["content-type"], "image/png");
  assert.equal(smallPut.headers.authorization, undefined);
  assert.equal(smallPut.headers.apikey, undefined);
  const tusRequests = fake.requests.filter((request) => ["POST", "HEAD", "PATCH"].includes(request.method));
  assert.ok(tusRequests.every((request) => request.url.startsWith(storageUrl)));
  assert.equal(tusRequests.find((request) => request.method === "POST").headers["x-signature"], "frame-signature");
  assert.ok(tusRequests.every((request) => request.headers.authorization === undefined && request.headers.apikey === undefined));
  assert.ok(tusRequests.filter((request) => request.method === "PATCH").every((request) => request.body.byteLength <= 6 * 1024 * 1024));
  assert.ok(progress.some(([uploaded]) => uploaded > 0));
});

test("sends large local-backend captures directly to their signed upload URLs", async () => {
  const largeSize = 6 * 1024 * 1024 + 1;
  const snapshotAsset = { fileName: "snapshot.json", contentType: "application/json", sizeBytes: 1, sha256: "1".repeat(64), bytes: new Uint8Array([1]) };
  const assets = [{ assetKey: "frame", fileName: "frame.png", contentType: "image/png", sizeBytes: largeSize, sha256: "2".repeat(64), bytes: new Uint8Array(largeSize) }];
  const fake = FakeXHRFactory();
  await uploadCaptureAssets({
    intent: {
      storageUrl,
      bucket,
      uploadProtocol: "direct",
      snapshot: { path: snapshotPath, token: "snapshot-signature" },
      uploads: [{ assetKey: "frame", path: renderPath, token: "frame-signature" }],
    },
    snapshotAsset,
    assets,
    expectedStorageOrigin: storageUrl,
    session: createUploadSessionState(),
    xhrFactory: fake.xhrFactory,
  });

  assert.deepEqual(fake.requests.map(({ method }) => method), ["PUT", "PUT"]);
  assert.ok(fake.requests.every((request) => request.url.includes("/storage/v1/object/upload/sign/")));
  assert.equal(new URL(fake.requests[1].url).searchParams.get("token"), "frame-signature");
});

test("resumes an interrupted TUS upload from its saved URL without requesting a new object", async () => {
  const size = 6 * 1024 * 1024 + 4;
  const intent = {
    storageUrl,
    bucket,
    snapshot: { path: snapshotPath, token: "snapshot-signature" },
    uploads: [{ assetKey: "large", path: renderPath, token: "large-signature" }],
  };
  const snapshotAsset = { fileName: "snapshot.json", contentType: "application/json", sizeBytes: 1, sha256: "1".repeat(64), bytes: new Uint8Array([1]) };
  const assets = [{ assetKey: "large", fileName: "large.png", contentType: "image/png", sizeBytes: size, sha256: "2".repeat(64), bytes: new Uint8Array(size) }];
  const session = createUploadSessionState();
  const interrupted = FakeXHRFactory({
    POST: () => ({ status: 201, headers: { Location: "/storage/v1/upload/resumable/session-2" } }),
    HEAD: () => ({ status: 204, headers: { "Upload-Offset": "0" } }),
    PATCH: () => ({ error: true }),
  });

  await assert.rejects(() => uploadCaptureAssets({ intent, snapshotAsset, assets, expectedStorageOrigin: storageUrl, session, xhrFactory: interrupted.xhrFactory }));
  assert.equal(session.resumableUrls.get("large"), `${storageUrl}/storage/v1/upload/resumable/session-2`);

  const resumed = FakeXHRFactory({
    HEAD: () => ({ status: 204, headers: { "Upload-Offset": String(6 * 1024 * 1024) } }),
    PATCH: (xhr) => ({ status: 204, headers: { "Upload-Offset": String(Number(xhr.headers["upload-offset"]) + xhr.body.byteLength) } }),
  });
  await uploadCaptureAssets({ intent, snapshotAsset, assets, expectedStorageOrigin: storageUrl, session, xhrFactory: resumed.xhrFactory });

  assert.equal(resumed.requests[0].method, "HEAD");
  assert.equal(resumed.requests.filter((request) => request.method === "POST").length, 0);
  assert.equal(resumed.requests.filter((request) => request.method === "PATCH").length, 1);
  assert.equal(resumed.requests.find((request) => request.method === "PATCH").body.byteLength, 4);
});

test("rejects a TUS upload URL outside the configured Storage host", async () => {
  const fake = FakeXHRFactory({
    POST: () => ({ status: 201, headers: { Location: "https://attacker.example/upload/session" } }),
  });
  await assert.rejects(() => uploadCaptureAssets({
    intent: {
      storageUrl,
      bucket,
      snapshot: { path: snapshotPath, token: "snapshot-signature" },
      uploads: [{ assetKey: "large", path: renderPath, token: "large-signature" }],
    },
    snapshotAsset: { fileName: "snapshot.json", contentType: "application/json", sizeBytes: 1, sha256: "1".repeat(64), bytes: new Uint8Array([1]) },
    assets: [{ assetKey: "large", fileName: "large.bin", contentType: "image/png", sizeBytes: 6 * 1024 * 1024 + 1, sha256: "2".repeat(64), bytes: new Uint8Array(6 * 1024 * 1024 + 1) }],
    expectedStorageOrigin: storageUrl,
    session: createUploadSessionState(),
    xhrFactory: fake.xhrFactory,
  }), /configured Supabase Storage host/);
});

test("aborts an active Storage request when the user cancels", async () => {
  const intent = {
    storageUrl,
    bucket,
    snapshot: { path: snapshotPath, token: "snapshot-signature" },
    uploads: [],
  };
  const xhrFactory = () => ({
    upload: {},
    open() {},
    setRequestHeader() {},
    send() {},
    abort() { this.onabort?.(); },
  });
  const controller = new AbortController();
  const promise = uploadCaptureAssets({
    intent,
    snapshotAsset: { fileName: "snapshot.json", contentType: "application/json", sizeBytes: 1, sha256: "1".repeat(64), bytes: new Uint8Array([1]) },
    assets: [],
    expectedStorageOrigin: storageUrl,
    session: createUploadSessionState(),
    xhrFactory,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(promise, /Upload canceled/);
});

test("builds the finalize request from staged object paths only", () => {
  const manifest = buildFinalizeManifest({
    snapshotPath,
    assets: { overview: renderPath, frame: "c".repeat(48) },
    baselineVersionId: "baseline-version",
    frameMatches: [{ beforeFrameId: "old-frame", afterFrameId: "new-frame" }],
  });

  assert.deepEqual(manifest, {
    snapshotPath,
    assets: { overview: renderPath, frame: "c".repeat(48) },
    baselineVersionId: "baseline-version",
    frameMatches: [{ beforeFrameId: "old-frame", afterFrameId: "new-frame" }],
  });
  assert.equal("snapshot" in manifest, false);
});
