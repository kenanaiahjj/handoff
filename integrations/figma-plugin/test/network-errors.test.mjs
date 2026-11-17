import assert from "node:assert/strict";
import test from "node:test";
import { withNetworkDiagnostics } from "../src/network-errors.ts";

test("an unreachable request names the address instead of a bare Failed to fetch, after one retry", async () => {
  let calls = 0;
  const fetcher = withNetworkDiagnostics(async () => { calls += 1; throw new TypeError("Failed to fetch"); }, 0);
  await assert.rejects(fetcher("http://localhost:3000/api/capture-sessions/uploads", { method: "POST" }),
    /Couldn’t reach http:\/\/localhost:3000\/api\/capture-sessions\/uploads \(Failed to fetch\)/);
  assert.equal(calls, 2);
});

test("a passing network blip is retried once and succeeds", async () => {
  let calls = 0;
  const fetcher = withNetworkDiagnostics(async () => { calls += 1; if (calls === 1) throw new TypeError("Failed to fetch"); return new Response("{}"); }, 0);
  assert.equal((await fetcher("http://localhost:3000/api/capture-sessions/preview")).status, 200);
  assert.equal(calls, 2);
});

test("finalizing is never sent twice, and cancellation is not retried", async () => {
  let calls = 0;
  const fetcher = withNetworkDiagnostics(async () => { calls += 1; throw new TypeError("Failed to fetch"); }, 0);
  await assert.rejects(fetcher("http://localhost:3000/api/capture-sessions/snapshot", { method: "POST" }), /Couldn’t reach/);
  assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort();
  let aborted = 0;
  const abortable = withNetworkDiagnostics(async () => { aborted += 1; throw new DOMException("aborted", "AbortError"); }, 0);
  await assert.rejects(abortable("http://localhost:3000/api/capture-sessions/preview", { signal: controller.signal }), /aborted/);
  assert.equal(aborted, 1);
});
