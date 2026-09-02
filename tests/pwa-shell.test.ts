import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  markAnonymousOfflineWorkoutShell,
  OFFLINE_WORKOUT_SHELL_MARKER,
  OFFLINE_WORKOUT_SHELL_REQUEST_HEADER,
} from "../src/lib/offline-workout-shell";
import {
  INSTALL_OFFER_DISMISS_MS,
  detectInstallPlatform,
  hasActiveInstallDismissal,
  installInstructions,
} from "../src/lib/pwa-install";

const root = process.cwd();

interface ServiceWorkerTestHooks {
  precacheShell: () => Promise<void>;
  networkNavigation: (request: Request) => Promise<Response>;
}

async function runOfflineWorkoutShellHarness() {
  const origin = "https://irondesk.example";
  const stores = new Map<string, Map<string, Response>>();
  const requested: Request[] = [];
  let offline = false;

  const requestUrl = (input: RequestInfo | URL): string => {
    if (typeof input === "string") return new URL(input, origin).href;
    if (input instanceof URL) return input.href;
    return input.url;
  };
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(requestUrl(input));
    requested.push(request.clone());
    if (offline) throw new TypeError("Failed to fetch");
    const url = new URL(request.url);
    if (url.pathname === "/workout") {
      return new Response(
        '<!doctype html><html><head><link rel="stylesheet" href="/assets/app.abc.css"></head><body><div data-testid="workout-shell"></div><script type="module" src="/assets/app.abc.js"></script></body></html>',
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            [OFFLINE_WORKOUT_SHELL_REQUEST_HEADER]: OFFLINE_WORKOUT_SHELL_MARKER,
          },
        },
      );
    }
    if (url.pathname === "/offline.html") {
      return new Response("IRONDESK_OFFLINE_FALLBACK", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response(`asset:${url.pathname}`, { status: 200 });
  };

  const cacheStorage = {
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        addAll: async (inputs: RequestInfo[]) => {
          for (const input of inputs) {
            const request = new Request(new URL(String(input), origin));
            const response = await fetchImpl(request);
            store.set(request.url, response.clone());
          }
        },
        put: async (input: RequestInfo | URL, response: Response) => {
          store.set(requestUrl(input), response.clone());
        },
        keys: async () => [...store.keys()].map((url) => new Request(url)),
        delete: async (input: RequestInfo | URL) => store.delete(requestUrl(input)),
      };
    },
    match: async (input: RequestInfo | URL) => {
      const key = requestUrl(input);
      for (const store of stores.values()) {
        const response = store.get(key);
        if (response) return response.clone();
      }
      return undefined;
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };

  const worker = readFileSync(join(root, "public", "sw.js"), "utf8");
  const context: Record<string, unknown> = {
    URL,
    Request,
    Response,
    fetch: fetchImpl,
    caches: cacheStorage,
    setTimeout,
    clearTimeout,
    self: {
      location: { origin },
      addEventListener: () => undefined,
      skipWaiting: () => undefined,
      clients: { claim: () => Promise.resolve() },
    },
  };
  runInNewContext(
    `${worker}\n;globalThis.__irondeskServiceWorkerTest = { precacheShell, networkNavigation };`,
    context,
  );
  const hooks = context["__irondeskServiceWorkerTest"] as ServiceWorkerTestHooks;
  await hooks.precacheShell();
  offline = true;

  return {
    requested,
    workout: await hooks.networkNavigation(new Request(`${origin}/workout`)),
    otherRoute: await hooks.networkNavigation(new Request(`${origin}/history`)),
    cachedKeys: [...stores.values()].flatMap((store) => [...store.keys()]),
  };
}

function pngDimensions(relativePath: string) {
  const bytes = readFileSync(join(root, relativePath));
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

describe("IronDesk PWA manifest", () => {
  const manifest = JSON.parse(
    readFileSync(join(root, "public", "manifest.webmanifest"), "utf8"),
  ) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    background_color: string;
    theme_color: string;
    icons: Array<{ src: string; sizes: string; purpose: string }>;
  };

  it("declares the branded standalone application", () => {
    expect(manifest).toMatchObject({
      name: "IronDesk",
      short_name: "IronDesk",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#050a12",
      theme_color: "#050a12",
    });
  });

  it("ships correctly sized any-purpose and maskable icons", () => {
    for (const icon of manifest.icons) {
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(pngDimensions(join("public", icon.src.replace(/^\//, "")))).toEqual({
        width,
        height,
      });
    }
    expect(manifest.icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any")).toBe(
      true,
    );
    expect(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any")).toBe(
      true,
    );
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    expect(pngDimensions(join("public", "icons", "apple-touch-icon.png"))).toEqual({
      width: 180,
      height: 180,
    });
  });
});

describe("PWA safety and lifecycle wiring", () => {
  it("uses the offline-finalization hotfix cache epoch", () => {
    const worker = readFileSync(join(root, "public", "sw.js"), "utf8");
    expect(worker).toContain('const SHELL_VERSION = "2026-09-02-6"');
    expect(worker).toContain("const SHELL_CACHE = `${CACHE_PREFIX}shell-${SHELL_VERSION}`");
    expect(worker).toContain("const STATIC_CACHE = `${CACHE_PREFIX}static-${SHELL_VERSION}`");
  });

  it("caches only a verified anonymous workout shell and keeps API/auth responses out", () => {
    const worker = readFileSync(join(root, "public", "sw.js"), "utf8");
    expect(worker).toContain('const OFFLINE_URL = "/offline.html"');
    expect(worker).toContain('const WORKOUT_SHELL_URL = "/workout"');
    expect(worker).toContain('credentials: "omit"');
    expect(worker).toContain("response.headers.get(WORKOUT_SHELL_HEADER)");
    expect(worker).toContain('"/favicon.ico"');
    expect(worker).toContain('request.mode === "navigate"');
    expect(worker).toContain("return await fetch(request)");
    const navigationHandler = worker.slice(
      worker.indexOf("async function networkNavigation"),
      worker.indexOf("async function staticAsset"),
    );
    expect(navigationHandler).not.toContain("cache.put");
    expect(worker).toContain('event.data?.type === "SKIP_WAITING"');
  });

  it("marks only credential-free, successful workout HTML as an offline shell", () => {
    const request = new Request("https://irondesk.example/workout", {
      headers: {
        [OFFLINE_WORKOUT_SHELL_REQUEST_HEADER]: OFFLINE_WORKOUT_SHELL_MARKER,
      },
    });
    const html = () =>
      new Response("<!doctype html><p>public client shell</p>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });

    const marked = markAnonymousOfflineWorkoutShell(request, html());
    expect(marked.headers.get(OFFLINE_WORKOUT_SHELL_REQUEST_HEADER)).toBe(
      OFFLINE_WORKOUT_SHELL_MARKER,
    );
    expect(marked.headers.get("cache-control")).toBe("no-store");

    for (const unsafe of [
      new Request("https://irondesk.example/workout", {
        headers: {
          cookie: "session=private",
          [OFFLINE_WORKOUT_SHELL_REQUEST_HEADER]: OFFLINE_WORKOUT_SHELL_MARKER,
        },
      }),
      new Request("https://irondesk.example/workout", {
        headers: {
          authorization: "Bearer private",
          [OFFLINE_WORKOUT_SHELL_REQUEST_HEADER]: OFFLINE_WORKOUT_SHELL_MARKER,
        },
      }),
      new Request("https://irondesk.example/api/account/delete", {
        headers: {
          [OFFLINE_WORKOUT_SHELL_REQUEST_HEADER]: OFFLINE_WORKOUT_SHELL_MARKER,
        },
      }),
    ]) {
      expect(
        markAnonymousOfflineWorkoutShell(unsafe, html()).headers.get(
          OFFLINE_WORKOUT_SHELL_REQUEST_HEADER,
        ),
      ).toBeNull();
    }
  });

  it("returns the verified workout shell offline and preserves the public fallback elsewhere", async () => {
    const result = await runOfflineWorkoutShellHarness();
    const shellRequest = result.requested.find(
      (request) => new URL(request.url).pathname === "/workout",
    );

    expect(shellRequest?.credentials).toBe("omit");
    expect(shellRequest?.headers.get(OFFLINE_WORKOUT_SHELL_REQUEST_HEADER)).toBe(
      OFFLINE_WORKOUT_SHELL_MARKER,
    );
    expect(await result.workout.text()).toContain('data-testid="workout-shell"');
    expect(await result.otherRoute.text()).toBe("IRONDESK_OFFLINE_FALLBACK");
    expect(result.cachedKeys).toEqual(
      expect.arrayContaining([
        `${"https://irondesk.example"}/assets/app.abc.css`,
        `${"https://irondesk.example"}/assets/app.abc.js`,
      ]),
    );
    expect(result.cachedKeys.some((key) => /\/api\/|\/auth(?:\/|$)/.test(key))).toBe(false);
  });

  it("links the manifest, theme, Apple icon, and install manager from the app shell", () => {
    const rootRoute = readFileSync(join(root, "src", "routes", "__root.tsx"), "utf8");
    expect(rootRoute).toContain('rel: "manifest"');
    expect(rootRoute).toContain('name: "theme-color"');
    expect(rootRoute).toContain('rel: "apple-touch-icon"');
    expect(rootRoute).toContain("<PwaProvider>");
  });

  it("does not enter a reload loop when the offline fallback is opened while online", () => {
    const offlinePage = readFileSync(join(root, "public", "offline.html"), "utf8");
    expect(offlinePage).toContain('window.addEventListener("online", retryAfterReconnect)');
    expect(offlinePage).toContain(
      'retry.addEventListener("click", () => window.location.reload())',
    );
    expect(offlinePage).not.toContain("if (online) window.location.reload()");
  });

  it("wires accessible network, install, and update controls", () => {
    const manager = readFileSync(
      join(root, "src", "components", "irondesk", "pwa-manager.tsx"),
      "utf8",
    );
    expect(manager).toContain('window.addEventListener("offline"');
    expect(manager).toContain('window.addEventListener("online"');
    expect(manager).toContain('window.addEventListener("beforeinstallprompt"');
    expect(manager).toContain('window.addEventListener("appinstalled"');
    expect(manager).toContain('navigator.serviceWorker.addEventListener("controllerchange"');
    expect(manager).toContain('aria-live="assertive"');
    expect(manager).toContain('aria-live="polite"');
    expect(manager).toContain('aria-label="Install IronDesk"');
    expect(manager).toContain("<DialogTitle");
    expect(manager).toContain('worker.postMessage({ type: "SKIP_WAITING" })');
    expect(manager).toContain('!window.location.pathname.startsWith("/auth")');
  });

  it("keeps the narrow mobile header within the viewport", () => {
    const shell = readFileSync(
      join(root, "src", "components", "irondesk", "app-shell.tsx"),
      "utf8",
    );
    expect(shell).toContain("max-[430px]:hidden");
  });
});

describe("platform-specific install guidance", () => {
  it("recognizes iOS, iPad desktop mode, Android, and desktop", () => {
    expect(detectInstallPlatform({ userAgent: "Mozilla/5.0 (iPhone)" })).toBe("ios");
    expect(
      detectInstallPlatform({
        userAgent: "Mozilla/5.0 (Macintosh)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe("ios");
    expect(detectInstallPlatform({ userAgent: "Mozilla/5.0 (Linux; Android 15)" })).toBe("android");
    expect(detectInstallPlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0)" })).toBe("desktop");
  });

  it("provides actionable instructions for each platform", () => {
    expect(installInstructions("ios").steps.join(" ")).toContain("Add to Home Screen");
    expect(installInstructions("android").steps.join(" ")).toContain("Install app");
    expect(installInstructions("desktop").steps.join(" ")).toContain("address bar");
  });

  it("allows a dismissed install offer to return after seven days", () => {
    const now = Date.UTC(2026, 7, 31);
    expect(hasActiveInstallDismissal(String(now - INSTALL_OFFER_DISMISS_MS + 1), now)).toBe(true);
    expect(hasActiveInstallDismissal(String(now - INSTALL_OFFER_DISMISS_MS), now)).toBe(false);
    expect(hasActiveInstallDismissal("not-a-date", now)).toBe(false);
  });
});
