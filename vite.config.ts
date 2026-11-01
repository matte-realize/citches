import { resolve } from "node:path";
import { defineConfig } from "vite";

// Relative asset paths so the build can be zipped and uploaded as a Twitch Extension.
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, "index.html"), overlay: resolve(__dirname, "overlay.html") }
    }
  }
});
