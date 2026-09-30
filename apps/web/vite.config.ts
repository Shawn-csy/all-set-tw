import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // These directories are generated outputs/cache, not source files. Keeping
    // them out of chokidar prevents build/typecheck output from retriggering
    // the dev server and creating unnecessary writes on the external volume.
    watch: {
      ignored: [
        "**/dist/**",
        "**/.svelte-check/**",
        "**/.wrangler/**",
        "**/.wrangler-config/**",
      ],
    },
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  build: {
    target: ["es2022", "chrome111", "firefox128", "safari16.4"],
  },
});
