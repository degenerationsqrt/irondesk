import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { APP_VERSION } from "../src/release.js";

const root = new URL("../", import.meta.url);

test("web, service worker, and Android releases use the same version", async () => {
  const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const packageLock = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));
  const serviceWorker = await readFile(new URL("public/sw.js", root), "utf8");
  const androidBuild = await readFile(new URL("android/app/build.gradle", root), "utf8");
  const capacitorBuild = await readFile(
    new URL("android/app/capacitor.build.gradle", root),
    "utf8",
  );
  const capacitorSettings = await readFile(
    new URL("android/capacitor.settings.gradle", root),
    "utf8",
  );

  assert.equal(packageJson.version, APP_VERSION);
  assert.equal(packageLock.version, APP_VERSION);
  assert.equal(packageLock.packages[""].version, APP_VERSION);
  assert.match(serviceWorker, new RegExp(`irondesk-v${APP_VERSION.replaceAll(".", "\\.")}`));
  assert.match(androidBuild, new RegExp(`versionName "${APP_VERSION.replaceAll(".", "\\.")}"`));
  assert.match(androidBuild, /versionCode 8/);
  assert.equal(packageJson.dependencies["@capacitor/app"], "^8.1.1");
  assert.match(capacitorBuild, /implementation project\(':capacitor-app'\)/);
  assert.match(capacitorSettings, /project\(':capacitor-app'\)/);
});

test("offline service-worker fallback returns HTML only for page navigation", async () => {
  const serviceWorker = await readFile(new URL("public/sw.js", root), "utf8");
  assert.match(serviceWorker, /event\.request\.mode === "navigate"/);
  assert.match(serviceWorker, /return Response\.error\(\)/);
});
