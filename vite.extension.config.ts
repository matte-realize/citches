import { resolve } from "node:path";
import { defineConfig } from "vite";

// Browser extension pages (overlay iframe + popup). The content script is built separately
// as a single classic script by vite.extension-content.config.ts.
export default defineConfig({
  root: resolve(__dirname, "extension"),
  base: "./",
  publicDir: resolve(__dirname, "extension/public"),
  build: {
    outDir: resolve(__dirname, "extension-dist"),
    emptyOutDir: true,
    target: "chrome110",
    chunkSizeWarningLimit: 1200,
    rollupOptions: { input: { overlay: resolve(__dirname, "extension/overlay.html"), popup: resolve(__dirname, "extension/popup.html") } }
  }
});
