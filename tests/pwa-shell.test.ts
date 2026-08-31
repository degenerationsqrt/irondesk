import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  INSTALL_OFFER_DISMISS_MS,
  detectInstallPlatform,
  hasActiveInstallDismissal,
  installInstructions,
} from "../src/lib/pwa-install";

const root = process.cwd();

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
  it("falls back to the public offline page without caching navigation or API responses", () => {
    const worker = readFileSync(join(root, "public", "sw.js"), "utf8");
    expect(worker).toContain('const OFFLINE_URL = "/offline.html"');
    expect(worker).toContain('"/favicon.ico"');
    expect(worker).toContain('request.mode === "navigate"');
    expect(worker).toContain("return await fetch(request)");
    expect(worker).not.toMatch(/cache\.put\([^\n]*navigate/i);
    expect(worker).toContain('event.data?.type === "SKIP_WAITING"');
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
    expect(offlinePage).toContain('retry.addEventListener("click", () => window.location.reload())');
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
