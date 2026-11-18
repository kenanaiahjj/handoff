/**
 * A browser reports every unreachable request as "Failed to fetch", which says nothing about which step
 * failed. This wrapper names the address, retries requests that are safe to repeat once, and leaves
 * capture finalization (which uses up the one-time token) to fail without a silent second attempt.
 */
export function describeUnreachable(url: string, cause: unknown) {
  let where = url;
  try {
    const parsed = new URL(url);
    where = parsed.origin + parsed.pathname;
  } catch {
    // Keep the raw value.
  }
  const reason = cause instanceof Error && cause.message ? ` (${cause.message})` : "";
  return new Error(`Couldn’t reach ${where}${reason}. Check that Asbir Handoff is running and reachable, then try again.`);
}

function requestUrl(input: RequestInfo | URL) {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

export function withNetworkDiagnostics(baseFetch: typeof fetch, retryDelayMs = 1_500): typeof fetch {
  return async (input, init) => {
    const url = requestUrl(input);
    const finalizes = /\/api\/capture-sessions\/snapshot(?:$|\?)/.test(new URL(url, "http://local").pathname + "");
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await baseFetch(input, init);
      } catch (error) {
        if (init?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
        if (!(error instanceof TypeError)) throw error;
        if (attempt === 0 && !finalizes) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
        throw describeUnreachable(url, error);
      }
    }
  };
}

const retryableFinalizeStatuses = new Set([429, 502, 503, 504]);

/**
 * Sends the finalize request, and if the connection drops or the server is briefly unavailable, asks
 * again after a pause. That is safe: Handoff answers a repeated finalize for a capture it already
 * saved with the saved version (also when two requests overlap), and nothing is saved twice. Without
 * this, a dropped connection after a long upload looked like a failed capture.
 */
export async function sendFinalizeWithRetry(
  send: () => Promise<Response>,
  options: { delaysMs?: number[]; signal?: AbortSignal; onRetry?: (attempt: number, reason: string) => void; wait?: (ms: number) => Promise<void> } = {},
) {
  const delays = options.delaysMs ?? [2_000, 5_000, 10_000, 20_000];
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    let reason: string;
    try {
      const response = await send();
      if (!retryableFinalizeStatuses.has(response.status) || attempt >= delays.length) return response;
      reason = `Handoff answered ${response.status}`;
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      if (attempt >= delays.length) throw error;
      reason = error instanceof Error ? error.message : "The connection dropped";
    }
    options.onRetry?.(attempt + 1, reason);
    await wait(delays[attempt]);
    if (options.signal?.aborted) throw new DOMException("The upload was cancelled.", "AbortError");
  }
}
