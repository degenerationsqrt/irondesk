(() => {
  "use strict";

  const sourceBase = "/irondesk";
  const targetOrigin = "https://irondeskpro.lovable.app";
  const pathname = window.location.pathname;
  let targetPath = "/";

  if (
    pathname === sourceBase ||
    pathname === `${sourceBase}/` ||
    pathname === `${sourceBase}/index.html`
  ) {
    targetPath = "/";
  } else if (pathname.startsWith(`${sourceBase}/`)) {
    targetPath = pathname.slice(sourceBase.length) || "/";
  }

  const destination =
    `${targetOrigin}${targetPath}` +
    window.location.search +
    window.location.hash;

  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) {
    canonical.href = `${targetOrigin}${targetPath}`;
  }

  const isIronDeskCache = (key) =>
    key === "irondesk-v0.9.0" || key.startsWith("irondesk-");

  const retireLegacyPwa = async () => {
    const jobs = [];

    if ("serviceWorker" in navigator) {
      jobs.push(
        navigator.serviceWorker
          .getRegistrations()
          .then((registrations) =>
            Promise.all(
              registrations
                .filter((registration) =>
                  registration.scope.startsWith(
                    `${window.location.origin}${sourceBase}/`,
                  ),
                )
                .map((registration) => registration.unregister()),
            ),
          ),
      );
    }

    if ("caches" in window) {
      jobs.push(
        window.caches
          .keys()
          .then((keys) =>
            Promise.all(
              keys.filter(isIronDeskCache).map((key) => caches.delete(key)),
            ),
          ),
      );
    }

    await Promise.allSettled(jobs);
  };

  const cleanupTimeout = new Promise((resolve) => {
    window.setTimeout(resolve, 800);
  });

  Promise.race([retireLegacyPwa(), cleanupTimeout]).finally(() => {
    window.location.replace(destination);
  });
})();
