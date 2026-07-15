import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll("\\", "/");
          if (/\/node_modules\/(?:@firebase\/|firebase\/compat\/)auth/.test(moduleId)) return "vendor-firebase-auth";
          if (/\/node_modules\/(?:@firebase\/|firebase\/compat\/)firestore/.test(moduleId)) {
            return "vendor-firebase-firestore";
          }
          if (moduleId.includes("/node_modules/@firebase/") || moduleId.includes("/node_modules/firebase/")) {
            return "vendor-firebase-core";
          }
          if (/\/node_modules\/(recharts|d3-|react-smooth|react-transition-group|victory-vendor)/.test(moduleId)) {
            return "vendor-charts";
          }
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(moduleId)) return "vendor-react";
          return undefined;
        },
      },
    },
  },
});
