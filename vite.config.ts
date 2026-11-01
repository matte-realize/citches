import { resolve } from "node:path";
import { defineConfig } from "vite";

// Relative asset paths so the build can be zipped and uploaded as a Twitch Extension.
export default defineConfig({
  base: "./",
  esbuild: { target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
  build: {
    target: "es2022",
    rollupOptions: {
      input: { main: resolve(__dirname, "index.html"), overlay: resolve(__dirname, "overlay.html"), config: resolve(__dirname, "config.html") }
    }
  }
});
