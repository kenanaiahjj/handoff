const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseOrigin(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (url.username || url.password) throw new Error(`${label} must not contain URL credentials.`);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopbackHosts.has(url.hostname))) {
    throw new Error(`${label} must use HTTPS outside local development.`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be an origin without a path, query, or fragment.`);
  }
  return url;
}

export function deriveStorageOrigin(supabaseUrl) {
  const url = parseOrigin(supabaseUrl, "SUPABASE_URL");
  const hostedApiSuffix = ".supabase.co";
  if (url.hostname.endsWith(hostedApiSuffix) && !url.hostname.endsWith(".storage.supabase.co")) {
    const projectRef = url.hostname.slice(0, -hostedApiSuffix.length);
    if (projectRef) url.hostname = `${projectRef}.storage.supabase.co`;
  }
  return url.origin;
}

export function requireExactOrigin(value, expectedOrigin) {
  const actual = parseOrigin(value, "Supabase Storage URL").origin;
  const expected = parseOrigin(expectedOrigin, "Configured Supabase Storage URL").origin;
  if (actual !== expected) throw new Error("The upload intent returned a different host from the configured Supabase Storage host.");
  return actual;
}

export function buildPluginNetworkAccess(handoffUrl, supabaseUrl, storageUrlOverride) {
  const handoff = parseOrigin(handoffUrl, "HANDOFF_PUBLIC_URL");
  const storageOrigin = deriveStorageOrigin(storageUrlOverride?.trim() || supabaseUrl);
  const allowedDomains = [`${handoff.origin}/api/capture-sessions/`, storageOrigin];
  const isLocal = loopbackHosts.has(handoff.hostname);
  return {
    allowedDomains,
    reasoning: "Send capture metadata to the configured Asbir Handoff server and captured files to its private Supabase Storage host.",
    devAllowedDomains: isLocal ? [...new Set([handoff.origin, storageOrigin])] : [],
  };
}
