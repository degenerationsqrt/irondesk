import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests exercise domain/server modules directly. Loading the app's Vite
// configuration also starts route generation, Nitro and deployment plugins.
// Keep those in the production build so tests remain deterministic and offline.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
  },
});
