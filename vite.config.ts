import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// STANDALONE=1 → single self-contained index.html for "double-click to run" releases.
// Default build remains the regular multi-file output for hosting.
const standalone = process.env.STANDALONE === "1";

// For standalone builds: inline all favicon/icon references as data URIs so the
// browser tab shows the app icon when index.html is opened directly via file://
// (no sibling files exist in the single-file release). Also strips the manifest
// link since manifests cannot load from file://.
function inlineStandaloneAssets(): Plugin {
  const svgDataUri = (path: string): string => {
    const content = readFileSync(resolve(path), "utf8");
    return `data:image/svg+xml;base64,${Buffer.from(content).toString("base64")}`;
  };
  const pngDataUri = (path: string): string => {
    const buf = readFileSync(resolve(path));
    return `data:image/png;base64,${buf.toString("base64")}`;
  };

  return {
    name: "inline-standalone-assets",
    apply: "build",
    transformIndexHtml(html) {
      // Each item: matcher regex in the source HTML → replacement href.
      const replacements: Array<[RegExp, string]> = [
        [/href="\.\/favicon\.svg"/g, `href="${svgDataUri("public/favicon.svg")}"`],
        [/href="\.\/favicon-16\.png"/g, `href="${pngDataUri("public/favicon-16.png")}"`],
        [/href="\.\/favicon-32\.png"/g, `href="${pngDataUri("public/favicon-32.png")}"`],
        [
          /href="\.\/apple-touch-icon\.png"/g,
          `href="${pngDataUri("public/apple-touch-icon.png")}"`,
        ],
      ];
      let out = html;
      for (const [re, val] of replacements) out = out.replace(re, val);
      // The PWA manifest cannot load from file:// — strip it.
      out = out.replace(/<link rel="manifest"[^>]*>\s*/g, "");
      return out;
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
