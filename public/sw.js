/* IronDesk PWA shell.
 *
 * Security boundary: authenticated HTML and API responses are never cached. The only HTML app
 * shell kept by this worker is a server-marked /workout response fetched without credentials.
 * Versioned static files referenced by that anonymous shell are cached with it so a durable local
 * Finish receipt can render after an offline reload. Bump SHELL_VERSION whenever this changes.
 */
const SHELL_VERSION = "2026-09-02-6";
const CACHE_PREFIX = "irondesk-pwa-";
const SHELL_CACHE = `${CACHE_PREFIX}shell-${SHELL_VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}static-${SHELL_VERSION}`;
const OFFLINE_URL = "/offline.html";
const WORKOUT_SHELL_URL = "/workout";
const WORKOUT_SHELL_CACHE_KEY = "/__irondesk/offline-workout-shell";
const WORKOUT_SHELL_HEADER = "x-irondesk-offline-shell";
const WORKOUT_SHELL_MARKER = "anonymous-workout-shell-v1";
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
  event.waitUntil(precacheShell());
});

function absoluteUrl(value) {
  return new URL(value, self.location.origin).href;
}

function shellAssetUrls(html) {
  const urls = new Set();
  const attributes = /(?:src|href)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(attributes)) {
    const url = new URL(match[1], self.location.origin);
    if (url.origin === self.location.origin && STATIC_ASSET_PATTERN.test(url.pathname)) {
      urls.add(url.href);
    }
  }
  return [...urls];
}

async function cacheAnonymousWorkoutShell(cache) {
  const request = new Request(absoluteUrl(WORKOUT_SHELL_URL), {
    method: "GET",
    credentials: "omit",
    cache: "reload",
    headers: {
      accept: "text/html",
      [WORKOUT_SHELL_HEADER]: WORKOUT_SHELL_MARKER,
    },
  });
  const response = await fetch(request);
  const contentType = response.headers.get("content-type") || "";
  if (
    !response.ok ||
    !contentType.toLowerCase().includes("text/html") ||
    response.headers.get(WORKOUT_SHELL_HEADER) !== WORKOUT_SHELL_MARKER
  ) {
    return false;
  }

  const html = await response.clone().text();
  const assets = shellAssetUrls(html);
  // A shell without its client entry point cannot restore local state. Keep
  // the public offline page as the fallback when the build shape is unexpected.
  if (!assets.some((url) => /\.(?:js|mjs)(?:$|\?)/i.test(url))) return false;

  const assetResponses = await Promise.all(
    assets.map(async (url) => {
      const assetRequest = new Request(url, {
        credentials: "omit",
        cache: "reload",
      });
      const assetResponse = await fetch(assetRequest);
      if (!assetResponse.ok) throw new Error(`Could not cache shell asset: ${url}`);
      return [assetRequest, assetResponse];
    }),
  );
  for (const [assetRequest, assetResponse] of assetResponses) {
    await cache.put(assetRequest, assetResponse);
  }
  await cache.put(absoluteUrl(WORKOUT_SHELL_CACHE_KEY), response);
  return true;
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(CORE_ASSETS);
  // The app remains installable even if a deployment is temporarily unable to
  // produce the verified anonymous shell. In that case navigation uses the
  // deliberately limited public offline page.
  try {
    await cacheAnonymousWorkoutShell(cache);
  } catch {
    // Best effort; OFFLINE_URL is already safe and available.
  }
}

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
    const url = new URL(request.url);
    if (
      url.origin === self.location.origin &&
      (url.pathname === WORKOUT_SHELL_URL || url.pathname === `${WORKOUT_SHELL_URL}/`)
    ) {
      const shell = await caches.match(absoluteUrl(WORKOUT_SHELL_CACHE_KEY));
      if (shell) return shell;
    }
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
