// Keeps screen images and per-screen element details on this device so canvases reopen fast.
//
// Only these requests are handled; pages, sign-in and every other API call go straight to the
// network untouched (intercepting them once broke the Google sign-in return trip). Both are safe to
// keep: image URLs are derived from the image bytes, and element details belong to a version, which
// never changes after capture. Access is still checked by the server the first time each is fetched.

const CACHE = "asbir-device-cache-v1";
const MAX_ENTRIES = 6000;

const cacheable = [
  /^\/api\/assets\/[^/]+$/,
  /^\/api\/review\/[^/]+\/assets\/[^/]+$/,
  /^\/api\/workspaces\/[^/]+\/projects\/[^/]+\/handoffs\/[^/]+\/versions\/[^/]+\/frames\/[^/]+\/nodes$/,
];

self.addEventListener("install", () => {
  // Replace any older worker right away.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("asbir-") && name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode === "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search) return;
  if (!cacheable.some((pattern) => pattern.test(url.pathname))) return;
  event.respondWith(cacheFirst(request, event));
});

async function cacheFirst(request, event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // Only keep complete, successful answers; errors and "not allowed" responses are never stored.
  if (response.status === 200 && response.type === "basic") {
    event.waitUntil(cache.put(request, response.clone()).then(() => trim(cache)).catch(() => undefined));
  }
  return response;
}

async function trim(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  // Oldest entries come first.
  for (let index = 0; index < excess; index += 1) await cache.delete(keys[index]);
}

// Notifications: a mention or a new version, sent by the server with web push.
self.addEventListener("push", (event) => {
  let message = { title: "Asbir Handoff", body: "", url: "/workspace" };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    // Keep the defaults for an empty or malformed push.
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      icon: "/icons/asbir-handoff-v3-192.png",
      badge: "/icons/asbir-handoff-v3-192.png",
      data: { url: message.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/workspace", self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        // navigate() only works on pages this worker controls; otherwise open a new window.
        const navigated = await existing.navigate(target.href).catch(() => null);
        if (navigated) return navigated;
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
