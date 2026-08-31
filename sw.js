const isIronDeskCache = (key) =>
  key === "irondesk-v0.9.0" || key.startsWith("irondesk-");

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys.filter(isIronDeskCache).map((key) => caches.delete(key)),
      );

      await self.registration.unregister();
    })(),
  );
});
