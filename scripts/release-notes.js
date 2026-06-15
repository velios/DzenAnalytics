#!/usr/bin/env node
// Build GitHub release notes for a version straight from CHANGELOG.md.
//
// Single source of truth = CHANGELOG.md — exactly the same text the in-app
// «Что нового» renders. The only git-release-only addition is the standard
// footer (install instructions + compare link); the changelog body itself
// carries no install/asset noise, so the app and the release page match.
//
// Usage:
//   node scripts/release-notes.js [version]   # default: package.json version
//   gh release edit vX.Y.Z --notes "$(node scripts/release-notes.js X.Y.Z)"

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "https://github.com/DEADover/DzenAnalytics";

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const version = process.argv[2] || pkg.version;

const lines = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8").split("\n");

// Collect "## vX.Y.Z …" headers in document order (newest first).
const headers = [];
const headerRe = /^##\s+v(\d+\.\d+\.\d+)\b/;
lines.forEach((l, i) => {
  const m = l.match(headerRe);
  if (m) headers.push({ i, version: m[1] });
});

const cur = headers.findIndex((h) => h.version === version);
if (cur === -1) {
  console.error(`Версия v${version} не найдена в CHANGELOG.md`);
  process.exit(1);
}

const start = headers[cur].i + 1;
const end = cur + 1 < headers.length ? headers[cur + 1].i : lines.length;
const body = lines.slice(start, end).join("\n").trim();

const prev = headers[cur + 1]?.version; // previous (older) release, if any

let footer =
  "\n\n---\n\n" +
  `**Установка:** скачайте \`DzenAnalytics-v${version}-standalone.zip\`, ` +
  "распакуйте и откройте `DzenAnalytics.html` в браузере — всё работает офлайн, " +
  "данные не покидают устройство.";
if (prev) {
  footer += `\n\nПолный список изменений: ${REPO}/compare/v${prev}...v${version}`;
}

process.stdout.write(body + footer + "\n");
