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

test("finalize is asked again after a dropped connection or a brief outage, then gives up", async () => {
  const { sendFinalizeWithRetry } = await import("../src/network-errors.ts");
  const waits = [];
  const wait = async (ms) => { waits.push(ms); };
  const replies = [new TypeError("Failed to fetch"), new Response("", { status: 504 }), new Response("{}", { status: 200 })];
  const retries = [];
  const response = await sendFinalizeWithRetry(async () => {
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  }, { delaysMs: [1, 2, 3], wait, onRetry: (attempt) => retries.push(attempt) });
  assert.equal(response.status, 200);
  assert.deepEqual(waits, [1, 2]);
  assert.deepEqual(retries, [1, 2]);

  // A real answer (even an error) is returned at once; only outages are retried.
  let calls = 0;
  const rejected = await sendFinalizeWithRetry(async () => { calls += 1; return new Response("{}", { status: 400 }); }, { delaysMs: [1], wait });
  assert.equal(rejected.status, 400);
  assert.equal(calls, 1);

  // After the last pause the outage is reported.
  await assert.rejects(sendFinalizeWithRetry(async () => { throw new TypeError("Failed to fetch"); }, { delaysMs: [1], wait }), /Failed to fetch/);
  const last = await sendFinalizeWithRetry(async () => new Response("", { status: 503 }), { delaysMs: [1], wait });
  assert.equal(last.status, 503);
});
