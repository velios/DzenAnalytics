// Zenmoney sync state — token + last sync timestamp + sync action.
//
// The token never leaves IndexedDB on this machine. We never log it, never
// embed it in error messages we display, and never include it in the
// backup/restore JSON path.

import { create } from "zustand";
import * as db from "../lib/db";
import { fetchDiff, checkToken, ZenApiError } from "../lib/zenmoney";
import { mapZenmoneyDiff } from "../lib/zenmoneyMap";
import {
  loadZenCache,
  saveZenCache,
  clearZenCache,
  applyDiff,
  cacheToDiffResponse,
} from "../lib/zenmoneyCache";
import { useDataStore } from "./useDataStore";
import { useCalibrationStore } from "./useCalibrationStore";
import { useCategoryMetaStore } from "./useCategoryMetaStore";
import type { ImportMeta } from "../types";

const TOKEN_KEY = "zenmoneyToken";
const TIMESTAMP_KEY = "zenmoneyServerTimestamp";
const LAST_SYNC_KEY = "zenmoneyLastSyncAt";

export type SyncStatus = "idle" | "checking" | "syncing" | "ok" | "error";

export interface LiveAccount {
  /** Account title — matches Transaction.account / outcomeAccount / incomeAccount. */
  title: string;
  /** Current balance in the account's native currency. */
  balance: number;
  /** ISO short code of the account's native currency. */
  currency: string;
  /** Account type from Zenmoney (ccard / debit / cash / loan / deposit / …). */
  type: string;
  /** True for accounts archived in Zenmoney. We surface these last/dimmed. */
  archive: boolean;
  /** Whether Zenmoney itself includes this account in the user's net worth. */
  inBalance: boolean;
}

/**
 * Returns the live per-account snapshot from the local Zenmoney cache, or null
 * if the cache is empty / user is in CSV mode. Reading from cache happens
 * lazily — call this from a hook or `useEffect`.
 */
export async function getLiveAccountsFromCache(): Promise<LiveAccount[] | null> {
  const cache = await loadZenCache();
  if (!cache) return null;
  const instrumentsById = new Map(cache.instruments.map((i) => [i.id, i]));
  return cache.accounts.map((a) => ({
    title: a.title,
    balance: a.balance || 0,
    currency: instrumentsById.get(a.instrument)?.shortTitle || "RUB",
    type: a.type,
    archive: a.archive,
    inBalance: a.inBalance,
  }));
}

/**
 * Full brand titles list from the Zenmoney merchant dictionary.
 * That's broader than "brands that appear in the user's transactions" —
 * it includes brands the user has set up but never charged through,
 * brands attached only to deleted operations, etc. Returns null when
 * there's no Zenmoney cache (CSV-only users).
 */
export async function getBrandTitlesFromCache(): Promise<string[] | null> {
  const cache = await loadZenCache();
  if (!cache) return null;
  return cache.merchants
    .map((m) => m.title.trim())
    .filter((t) => t.length > 0)
    .sort((a, b) => a.localeCompare(b, "ru"));
}

export interface SyncResult {
  count: number;
  currentBalance: number;
  /** True if this was a full sync (cache was empty or {force:true} was passed). */
  full: boolean;
  /** Delta sizes — how many entities arrived this round (helpful for "Свежее: +N"). */
  delta: {
    transactions: number;
    accounts: number;
    tags: number;
    deletions: number;
  };
}

interface ZenmoneyState {
  token: string | null;
  serverTimestamp: number;
  lastSyncAt: string | null;
  status: SyncStatus;
  error: string | null;
  loaded: boolean;
  hydrate: () => Promise<void>;
  saveToken: (token: string) => Promise<void>;
  validateAndSaveToken: (token: string) => Promise<boolean>;
  removeToken: () => Promise<void>;
  /**
   * Synchronise with Zenmoney. By default uses the last `serverTimestamp`
   * for an incremental diff; pass `{force: true}` to drop the local cache
   * and re-pull everything (useful after suspected corruption / renames /
   * for support).
   */
  sync: (opts?: { force?: boolean }) => Promise<SyncResult>;
}

export const useZenmoneyStore = create<ZenmoneyState>((set, get) => ({
  token: null,
  serverTimestamp: 0,
  lastSyncAt: null,
  status: "idle",
  error: null,
  loaded: false,

  hydrate: async () => {
    const [token, ts, last] = await Promise.all([
      db.loadJSON<string>(TOKEN_KEY),
      db.loadJSON<number>(TIMESTAMP_KEY),
      db.loadJSON<string>(LAST_SYNC_KEY),
    ]);
    set({
      token: token || null,
      serverTimestamp: ts || 0,
      lastSyncAt: last || null,
      loaded: true,
    });
  },

  saveToken: async (token) => {
    const trimmed = token.trim();
    await db.saveJSON(TOKEN_KEY, trimmed);
    set({ token: trimmed, error: null });
  },

  validateAndSaveToken: async (token) => {
    const trimmed = token.trim();
    if (!trimmed) {
      set({ error: "Введите токен" });
      return false;
    }
    set({ status: "checking", error: null });
    try {
      const ok = await checkToken(trimmed);
      if (!ok) {
        set({ status: "error", error: "Токен отклонён сервером (401)" });
        return false;
      }
      await db.saveJSON(TOKEN_KEY, trimmed);
      set({ token: trimmed, status: "idle", error: null });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось проверить токен";
      set({ status: "error", error: msg });
      return false;
    }
  },

  removeToken: async () => {
    await db.saveJSON(TOKEN_KEY, null);
    await db.saveJSON(TIMESTAMP_KEY, 0);
    await db.saveJSON(LAST_SYNC_KEY, null);
    await clearZenCache();
    await useCategoryMetaStore.getState().clear();
    set({
      token: null,
      serverTimestamp: 0,
      lastSyncAt: null,
      status: "idle",
      error: null,
    });
  },

  sync: async (opts = {}) => {
    const token = get().token;
    if (!token) {
      set({ status: "error", error: "Сначала подключите токен" });
      throw new Error("no token");
    }
    set({ status: "syncing", error: null });
    try {
      // Incremental by default. `force: true` (or no cache yet) → full sync
      // by sending serverTimestamp=0. The merged cache is then re-mapped
      // in full so renames/deletions propagate everywhere.
      const prevCache = opts.force ? null : await loadZenCache();
      const fromTs = prevCache?.serverTimestamp || 0;
      const diff = await fetchDiff(token, fromTs);
      const nextCache = applyDiff(prevCache, diff);
      await saveZenCache(nextCache);
      const mapped = mapZenmoneyDiff(cacheToDiffResponse(nextCache));
      const isFull = fromTs === 0;

      // Push transactions + rates into the main data store. setTransactions
      // already runs payee grouping + category rules + recomputes amountBase.
      const meta: ImportMeta = {
        importedAt: new Date().toISOString(),
        fileName: `Zen-мани API · ${mapped.accountsActive} счетов · ${mapped.tagsTotal} тегов`,
        totalRows: nextCache.transactions.length,
        parsed: mapped.transactions.length,
        skipped: nextCache.transactions.length - mapped.transactions.length,
        source: "api",
      };
      // Per-category meta (colour / icon / picture) for UI dots, treemap, etc.
      await useCategoryMetaStore.getState().setAll(mapped.categoryMeta);

      // Persist the rates that came with the diff so the next session boots
      // with up-to-date Zenmoney rates.
      await db.saveRates(mapped.rates);
      // Update store rates as well so re-aggregation uses fresh numbers.
      useDataStore.setState({ rates: mapped.rates });
      await useDataStore.getState().setTransactions(mapped.transactions, meta);

      // Auto-calibration: the API exposes current real balance per account,
      // which CSV lacks. Set calibration to today + current total so the
      // "Совокупный баланс" chart and KPIs show real values without manual
      // entry. We overwrite any existing calibration since the API value is
      // authoritative.
      const today = new Date().toISOString().slice(0, 10);
      await useCalibrationStore.getState().set({
        date: today,
        amount: Math.round(mapped.currentBalanceTotal),
      });

      const now = new Date().toISOString();
      await db.saveJSON(TIMESTAMP_KEY, diff.serverTimestamp);
      await db.saveJSON(LAST_SYNC_KEY, now);
      set({
        serverTimestamp: diff.serverTimestamp,
        lastSyncAt: now,
        status: "ok",
        error: null,
      });
      return {
        count: mapped.transactions.length,
        currentBalance: mapped.currentBalanceTotal,
        full: isFull,
        delta: {
          transactions: diff.transaction?.length || 0,
          accounts: diff.account?.length || 0,
          tags: diff.tag?.length || 0,
          deletions: diff.deletion?.length || 0,
        },
      };
    } catch (e) {
      let msg: string;
      if (e instanceof ZenApiError) {
        msg =
          e.status === 401
            ? "Токен недействителен или истёк (401). Подключите заново."
            : `Сервер: ${e.message}`;
      } else if (e instanceof Error) {
        msg = e.message;
      } else {
        msg = "Не удалось синхронизировать";
      }
      set({ status: "error", error: msg });
      throw e;
    }
  },
}));
