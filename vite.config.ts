import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// STANDALONE=1 → single self-contained index.html for "double-click to run" releases.
// Default build remains the regular multi-file output for hosting.
const standalone = process.env.STANDALONE === "1";

// For standalone builds: inline favicon/icon as data URIs so the browser tab shows
// the app icon when index.html is opened directly via file:// (no sibling files).
// Also strips the manifest link since manifests cannot load from file://.
function inlineStandaloneAssets(): Plugin {
  return {
    name: "inline-standalone-assets",
    apply: "build",
    transformIndexHtml(html) {
      const fav = readFileSync(resolve("public/favicon.svg"), "utf8");
      const icon = readFileSync(resolve("public/icon.svg"), "utf8");
      const favData = `data:image/svg+xml;base64,${Buffer.from(fav).toString("base64")}`;
      const iconData = `data:image/svg+xml;base64,${Buffer.from(icon).toString("base64")}`;
      return html
        .replace(/href="\.\/favicon\.svg"/g, `href="${favData}"`)
        .replace(/href="\.\/icon\.svg"/g, `href="${iconData}"`)
        .replace(/<link rel="manifest"[^>]*>\s*/g, "");
    },
  };
}

export default defineConfig({
  base: standalone ? "./" : "/",
  plugins: [
    react(),
    ...(standalone ? [inlineStandaloneAssets(), viteSingleFile()] : []),
  ],
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
