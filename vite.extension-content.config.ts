import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: resolve(__dirname, "extension-dist"),
    emptyOutDir: false,
    lib: { entry: resolve(__dirname, "extension/content.ts"), formats: ["iife"], name: "ChatCityContent", fileName: () => "content.js" }
  }
});
