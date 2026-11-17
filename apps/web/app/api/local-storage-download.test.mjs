import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("local signed downloads can be read by the Figma plugin (cross-origin), and only with a valid token", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "asbir-local-download-"));
  const prior = Object.fromEntries(["NODE_ENV", "ASBIR_LOCAL_DEV_MODE", "ASBIR_LOCAL_STORAGE_SECRET", "BETTER_AUTH_URL", "ASBIR_DATA_DIR"].map((name) => [name, process.env[name]]));
  Object.assign(process.env, { NODE_ENV: "development", ASBIR_LOCAL_DEV_MODE: "1", ASBIR_LOCAL_STORAGE_SECRET: "local-storage-test-secret", BETTER_AUTH_URL: "http://localhost:3000", ASBIR_DATA_DIR: directory });
  try {
    // The route serves from the local data directory, exactly as `npm run dev` does.
    const { LocalObjectStore } = await import("@/src/server/storage/local-object-store.ts");
    const route = await import("./local-storage/[key]/route.ts");
    const store = new LocalObjectStore(path.join(directory, "objects"));
    const key = "c".repeat(48);
    await store.put(key, new Uint8Array([137, 80, 78, 71]), "image/png");
    const url = new URL(await store.createSignedDownloadUrl(key, { expiresIn: 60 }));
    const ok = await route.GET(new Request(url, { headers: { Origin: "null" } }), { params: Promise.resolve({ key }) });
    assert.equal(ok.status, 200, await ok.clone().text());
    assert.equal(ok.headers.get("access-control-allow-origin"), "*", "without this the plugin sees only “Failed to fetch”");
    assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [137, 80, 78, 71]);

    url.searchParams.set("token", "1999999999999.invalidinvalidinvalidinvalidinvalidinvalidinv");
    const rejected = await route.GET(new Request(url), { params: Promise.resolve({ key }) });
    assert.equal(rejected.status, 404);
    assert.equal(rejected.headers.get("access-control-allow-origin"), "*");

    const preflight = route.OPTIONS();
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  } finally {
    for (const [name, value] of Object.entries(prior)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(directory, { recursive: true, force: true });
  }
});
