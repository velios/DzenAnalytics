import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// STANDALONE=1 → single self-contained index.html for "double-click to run" releases.
// Default build remains the regular multi-file output for hosting.
const standalone = process.env.STANDALONE === "1";

export default defineConfig({
  base: standalone ? "./" : "/",
  plugins: [react(), ...(standalone ? [viteSingleFile()] : [])],
  build: standalone
    ? {
        // single-file build settings
        assetsInlineLimit: 100_000_000,
        cssCodeSplit: false,
        rollupOptions: { output: { inlineDynamicImports: true } },
      }
    : undefined,
  server: {
    port: 3030,
    strictPort: false,
    host: "127.0.0.1",
  },
});
