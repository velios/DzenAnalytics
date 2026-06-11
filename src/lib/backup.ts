// Backup helpers — gather the full IndexedDB snapshot into a JSON blob and
// trigger a browser download. Used by both manual «Backup» button on the
// /import page and the scheduled backup store.
//
// Token-like secrets are explicitly excluded. The Zenmoney access token and
// raw entity cache are intentionally NOT exported — those should never leave
// the device unencrypted.

import * as db from "./db";

export const BACKUP_VERSION = 1;

export interface BackupPayload {
  version: number;
  exportedAt: string;
  transactions: unknown;
  rates: unknown;
  importMeta: unknown;
  /** Legacy flat budgets (Record<category, number>). Kept for old backups. */
  budgets: unknown;
  /** New plan/fact budget lines (BudgetLine[]). */
  budgetsV2: unknown;
  goals: unknown;
  calibration: unknown;
  /** FIRE dashboard: account titles excluded from the capital total. */
  fireExcludedAccounts: unknown;
  /** Global "include off-balance accounts" setting. */
  includeOffBalance: unknown;
  savedViews: unknown;
  annotations: unknown;
  categoryFlags: unknown;
  inflation: unknown;
  payeeGrouping: unknown;
  categoryRules: unknown;
}

export async function buildBackupPayload(): Promise<BackupPayload> {
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    transactions: await db.loadTransactions(),
    rates: await db.loadRates(),
    importMeta: await db.loadImportMeta(),
    budgets: await db.loadJSON("budgets"),
    budgetsV2: await db.loadJSON("budgetsV2"),
    goals: await db.loadJSON("goals"),
    calibration: await db.loadJSON("calibration"),
    fireExcludedAccounts: await db.loadJSON("fireExcludedAccounts"),
    includeOffBalance: await db.loadJSON("includeOffBalance"),
    savedViews: await db.loadJSON("savedViews"),
    annotations: await db.loadJSON("annotations"),
    categoryFlags: await db.loadJSON("categoryFlags"),
    inflation: await db.loadJSON("inflation"),
    payeeGrouping: await db.loadJSON("payeeGrouping"),
    categoryRules: await db.loadJSON("categoryRules"),
  };
}

// ── Import validation ──────────────────────────────────────────────────
//
// A restore reads an arbitrary user-supplied JSON file and writes it
// straight into IndexedDB. We harden that path:
//   • reject anything that isn't a versioned object;
//   • type-check the few sections we know the shape of;
//   • strip prototype-pollution keys (`__proto__` / `constructor` /
//     `prototype`) from every nested object, so a crafted file can't
//     poison Object.prototype when sections are later merged;
//   • bound nesting depth and array sizes against decompression-style
//     blow-ups.

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 12;
const MAX_TRANSACTIONS = 1_000_000;

/** Recursively rebuild a JSON value, dropping dangerous keys and
 *  bounding nesting depth. Returns a clean copy (never the original). */
function deepSanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    return value.map((v) => deepSanitize(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      out[k] = deepSanitize(v, depth + 1);
    }
    return out;
  }
  return value; // primitive
}

/**
 * Parse + validate + sanitize a backup file's text. Throws an Error
 * with a user-facing Russian message on anything malformed. On success
 * returns a sanitized object safe to write into IndexedDB.
 */
export function parseAndValidateBackup(text: string): BackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error("Файл не является корректным JSON", { cause: e });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Бэкап должен быть JSON-объектом");
  }
  const obj = parsed as Record<string, unknown>;
  if (!obj.version) {
    throw new Error("Не похоже на бэкап DzenAnalytics (нет поля version)");
  }
  // transactions, if present, must be an array of bounded length.
  if (obj.transactions !== undefined) {
    if (!Array.isArray(obj.transactions)) {
      throw new Error("Поле «transactions» повреждено (ожидался массив)");
    }
    if (obj.transactions.length > MAX_TRANSACTIONS) {
      throw new Error("Слишком много операций в бэкапе");
    }
  }
  // rates, if present, must be an object (base + rates map).
  if (
    obj.rates !== undefined &&
    obj.rates !== null &&
    (typeof obj.rates !== "object" || Array.isArray(obj.rates))
  ) {
    throw new Error("Поле «rates» повреждено");
  }
  return deepSanitize(obj) as BackupPayload;
}

export function backupFileName(now: Date = new Date(), tag?: string): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const suffix = tag ? `-${tag}` : "";
  return `dzenanalytics-backup-${stamp}${suffix}.json`;
}

/**
 * Build the backup payload and trigger a browser download.
 * Returns the byte size of the downloaded JSON.
 */
export async function downloadBackup(tag?: string): Promise<{
  size: number;
  fileName: string;
}> {
  const payload = await buildBackupPayload();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const fileName = backupFileName(new Date(), tag);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the blob URL after the click had a chance to take effect.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { size: json.length, fileName };
}
