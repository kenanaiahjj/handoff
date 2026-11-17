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
