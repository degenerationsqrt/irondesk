/* IronDesk PWA shell.
 *
 * Security boundary: authenticated HTML and API responses are never cached. The worker only
 * precaches the public offline/install assets and opportunistically caches versioned static files.
 * Bump SHELL_VERSION when the offline shell or its core assets change.
 */
const SHELL_VERSION = "2026-08-31-4";
const CACHE_PREFIX = "irondesk-pwa-";
const SHELL_CACHE = `${CACHE_PREFIX}shell-${SHELL_VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}static-${SHELL_VERSION}`;
const OFFLINE_URL = "/offline.html";
const CORE_ASSETS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/irondesk-192.png",
  "/icons/irondesk-512.png",
  "/icons/irondesk-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/favicon.ico",
];
const STATIC_ASSET_PATTERN = /\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|ico|woff2?)$/i;
const MAX_STATIC_ENTRIES = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(CORE_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter(
                (name) =>
                  name.startsWith(CACHE_PREFIX) && ![SHELL_CACHE, STATIC_CACHE].includes(name),
              )
              .map((name) => caches.delete(name)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function trimCache(cacheName, maximumEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const overflow = keys.length - maximumEntries;
  if (overflow <= 0) return;
  await Promise.all(keys.slice(0, overflow).map((request) => cache.delete(request)));
}

async function networkNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

async function staticAsset(request) {
  const cached = await caches.match(request);
  const fetched = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(STATIC_CACHE);
        await cache.put(request, response.clone());
        await trimCache(STATIC_CACHE, MAX_STATIC_ENTRIES);
      }
      return response;
    })
    .catch(() => cached || Response.error());

  return cached || fetched;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkNavigation(request));
    return;
  }

  if (STATIC_ASSET_PATTERN.test(url.pathname)) {
    event.respondWith(staticAsset(request));
  }
});
