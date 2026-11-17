import assert from "node:assert/strict";
import test from "node:test";
import { buildPluginNetworkAccess, deriveStorageOrigin, requireExactOrigin } from "../src/network-access.mjs";

test("limits plugin network access to the configured Handoff capture route and Storage host", () => {
  const networkAccess = buildPluginNetworkAccess(
    "https://handoff.example.com",
    "https://project-ref.supabase.co",
  );

  assert.deepEqual(networkAccess.allowedDomains, [
    "https://handoff.example.com/api/capture-sessions/",
    "https://project-ref.storage.supabase.co",
  ]);
  assert.equal(networkAccess.allowedDomains.includes("*"), false);
  assert.equal(networkAccess.allowedDomains.some((domain) => domain.includes(".supabase.co/")), false);
});

test("uses the configured local Supabase host without broadening it", () => {
  assert.equal(deriveStorageOrigin("http://127.0.0.1:54321"), "http://127.0.0.1:54321");
  assert.deepEqual(
    buildPluginNetworkAccess("http://localhost:3000", "http://127.0.0.1:54321").devAllowedDomains,
    ["http://localhost:3000", "http://127.0.0.1:54321"],
  );
});

test("uses the configured Storage origin override in the Figma allowlist", () => {
  assert.deepEqual(
    buildPluginNetworkAccess(
      "https://handoff.example.com",
      "https://project-ref.supabase.co",
      "https://assets.example.com",
    ).allowedDomains,
    ["https://handoff.example.com/api/capture-sessions/", "https://assets.example.com"],
  );
});

test("rejects non-HTTPS remote hosts, credentials, and unexpected Storage origins", () => {
  assert.throws(() => buildPluginNetworkAccess("http://handoff.example.com", "https://project-ref.supabase.co"), /HTTPS/);
  assert.throws(() => deriveStorageOrigin("https://service:secret@project-ref.supabase.co"), /credentials/);
  assert.throws(() => requireExactOrigin("https://attacker.example", "https://project-ref.storage.supabase.co"), /configured Supabase Storage host/);
});
