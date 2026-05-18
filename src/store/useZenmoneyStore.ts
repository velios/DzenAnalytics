// Zenmoney sync state — token + last sync timestamp + sync action.
//
// The token never leaves IndexedDB on this machine. We never log it, never
// embed it in error messages we display, and never include it in the
// backup/restore JSON path.

import { create } from "zustand";
import * as db from "../lib/db";
import { fetchDiff, checkToken, ZenApiError } from "../lib/zenmoney";
import { mapZenmoneyDiff } from "../lib/zenmoneyMap";
import { useDataStore } from "./useDataStore";
import type { ImportMeta } from "../types";

const TOKEN_KEY = "zenmoneyToken";
const TIMESTAMP_KEY = "zenmoneyServerTimestamp";
const LAST_SYNC_KEY = "zenmoneyLastSyncAt";

export type SyncStatus = "idle" | "checking" | "syncing" | "ok" | "error";

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
  sync: () => Promise<{ count: number }>;
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
    set({
      token: null,
      serverTimestamp: 0,
      lastSyncAt: null,
      status: "idle",
      error: null,
    });
  },

  sync: async () => {
    const token = get().token;
    if (!token) {
      set({ status: "error", error: "Сначала подключите токен" });
      throw new Error("no token");
    }
    set({ status: "syncing", error: null });
    try {
      // Full sync each time — simpler and always consistent. With ~10k
      // transactions the response is ~8 MB / ~1 second to download.
      const diff = await fetchDiff(token, 0);
      const mapped = mapZenmoneyDiff(diff);

      // Push transactions + rates into the main data store. setTransactions
      // already runs payee grouping + category rules + recomputes amountBase.
      const meta: ImportMeta = {
        importedAt: new Date().toISOString(),
        fileName: `Zen-мани API · ${mapped.accountsActive} счетов · ${mapped.tagsTotal} тегов`,
        totalRows: diff.transaction.length,
        parsed: mapped.transactions.length,
        skipped: diff.transaction.length - mapped.transactions.length,
      };
      // Persist the rates that came with the diff so the next session boots
      // with up-to-date Zenmoney rates.
      await db.saveRates(mapped.rates);
      // Update store rates as well so re-aggregation uses fresh numbers.
      useDataStore.setState({ rates: mapped.rates });
      await useDataStore.getState().setTransactions(mapped.transactions, meta);

      const now = new Date().toISOString();
      await db.saveJSON(TIMESTAMP_KEY, diff.serverTimestamp);
      await db.saveJSON(LAST_SYNC_KEY, now);
      set({
        serverTimestamp: diff.serverTimestamp,
        lastSyncAt: now,
        status: "ok",
        error: null,
      });
      return { count: mapped.transactions.length };
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
