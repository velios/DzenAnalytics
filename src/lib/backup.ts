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
  budgets: unknown;
  goals: unknown;
  calibration: unknown;
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
    goals: await db.loadJSON("goals"),
    calibration: await db.loadJSON("calibration"),
    savedViews: await db.loadJSON("savedViews"),
    annotations: await db.loadJSON("annotations"),
    categoryFlags: await db.loadJSON("categoryFlags"),
    inflation: await db.loadJSON("inflation"),
    payeeGrouping: await db.loadJSON("payeeGrouping"),
    categoryRules: await db.loadJSON("categoryRules"),
  };
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
