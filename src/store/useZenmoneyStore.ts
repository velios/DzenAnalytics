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
import {
  buildPushItems,
  buildDeletions,
  sendPush,
  type PushBuildResult,
} from "../lib/zenmoneyPush";
import { loadSnapshotIndex, takeSnapshot } from "../lib/cloudSnapshots";
import { useDataStore } from "./useDataStore";
import { useCalibrationStore } from "./useCalibrationStore";
import { useCategoryMetaStore } from "./useCategoryMetaStore";
import { useEditsStore } from "./useEditsStore";
import { useDeletedStore } from "./useDeletedStore";
import { useSyncLogStore } from "./useSyncLogStore";
import { formatNum } from "../lib/format";
import type { ImportMeta } from "../types";

const TOKEN_KEY = "zenmoneyToken";
const TIMESTAMP_KEY = "zenmoneyServerTimestamp";
const LAST_SYNC_KEY = "zenmoneyLastSyncAt";
const PUSH_ENABLED_KEY = "zenmoneyPushEnabled";
const PUSH_MODE_KEY = "zenmoneyPushMode";
const LAST_PUSH_KEY = "zenmoneyLastPushAt";
const SNAPSHOT_POLICY_KEY = "zenmoneySnapshotPolicy";
const AUTO_SYNC_ENABLED_KEY = "zenmoneyAutoSyncEnabled";
const AUTO_SYNC_VALUE_KEY = "zenmoneyAutoSyncValue";
const AUTO_SYNC_UNIT_KEY = "zenmoneyAutoSyncUnit";

/**
 * Auto-sync interval — how often the background poller wakes up to
 * pull from Zenmoney. Stored as (value, unit) so the UI can show "10
 * минут" instead of "600000 мс".
 *
 * Minimum effective interval is 1 minute regardless of the unit — we
 * don't want to hammer the API.
 */
export type AutoSyncUnit = "min" | "hour" | "day";
const AUTO_SYNC_VALUE_DEFAULT = 30;
const AUTO_SYNC_UNIT_DEFAULT: AutoSyncUnit = "min";

export function autoSyncToMs(value: number, unit: AutoSyncUnit): number {
  const v = Math.max(1, Math.floor(value));
  const base = unit === "min" ? 60_000 : unit === "hour" ? 3_600_000 : 86_400_000;
  // Hard floor of 1 minute — protects against a misconfigured "0 min"
  // turning into a tight loop.
  return Math.max(60_000, v * base);
}

/**
 * When to take a cloud safety snapshot before pushing local edits.
 *   • "always" — every push triggers a full diff (slowest, safest;
 *     used during debugging).
 *   • "daily"  — at most once per 24h. Snapshot is skipped if a fresh
 *     one already exists. Sensible default for everyday use.
 *   • "never"  — no automatic snapshots. User can still take them
 *     manually from Settings.
 */
export type SnapshotPolicy = "always" | "daily" | "never";
const SNAPSHOT_POLICY_DEFAULT: SnapshotPolicy = "daily";
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type SyncStatus = "idle" | "checking" | "syncing" | "ok" | "error";

/**
 * How (and whether) local edits flow back to Zenmoney.
 *   • "off"      — read-only mode. Edits accumulate locally; nothing
 *                  is ever pushed. Safest default.
 *   • "manual"   — Push is enabled, but only fires when the user
 *                  clicks "Отправить N правок" in Settings.
 *   • "auto"     — Push fires automatically ~2 s after the last edit
 *                  (debounce). Closest to "wysiwyg" cloud editing.
 *   • "on-sync"  — Push is attached to every sync (pull): when the
 *                  user clicks "Синхронизировать" (or the scheduler
 *                  fires), we pull first, then push pending edits.
 *                  Lower API pressure than "auto".
 */
export type PushMode = "off" | "manual" | "auto" | "on-sync";
const PUSH_MODE_DEFAULT: PushMode = "off";

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

export interface PushResult {
  /** How many local edits were successfully sent and acknowledged by Zenmoney. */
  pushed: number;
  /** Edits that couldn't be pushed (with reasons). They stay in the local overlay. */
  skipped: PushBuildResult["skipped"];
  /** ISO timestamp of the snapshot we took right before sending — for audit. */
  snapshotId: string | null;
}

interface ZenmoneyState {
  token: string | null;
  serverTimestamp: number;
  lastSyncAt: string | null;
  status: SyncStatus;
  error: string | null;
  loaded: boolean;

  // ── Phase 1: bi-directional sync (opt-in, off by default) ─────────────
  /** How edits flow back to Zenmoney. Default "off" (read-only). */
  pushMode: PushMode;
  /** Convenience derived flag: true when pushMode !== "off". Read-only
   *  — drive via `setPushMode`. Kept so existing UI checks "is push at
   *  all enabled?" without enumerating modes. */
  pushEnabled: boolean;
  /** ISO timestamp of the last successful push, or null. */
  lastPushAt: string | null;
  /** "idle" / "syncing" while a push is in flight; mirrors regular sync. */
  pushStatus: SyncStatus;
  /** Last push error message (for inline UI display). Cleared on next push. */
  pushError: string | null;
  /** Last push result (counts of pushed / skipped). */
  lastPushResult: PushResult | null;
  /** How often to auto-snapshot before push. See `SnapshotPolicy`. */
  snapshotPolicy: SnapshotPolicy;

  // ── Auto-sync schedule ─────────────────────────────────────────────────
  /** When enabled, a background poller calls `sync()` at the chosen
   *  interval. Default off — manual sync is the safe baseline. */
  autoSyncEnabled: boolean;
  /** Numeric component of the interval, e.g. 30 for "30 минут". */
  autoSyncValue: number;
  /** Unit component of the interval — minutes / hours / days. */
  autoSyncUnit: AutoSyncUnit;

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

  /** Persist the push mode + recompute `pushEnabled` derived flag. */
  setPushMode: (mode: PushMode) => Promise<void>;
  setSnapshotPolicy: (policy: SnapshotPolicy) => Promise<void>;
  /**
   * Push all currently-pending local edits (`useEditsStore.edits`) to
   * Zenmoney via `POST /v8/diff/`. Side effects:
   *   • takes a fresh cloud snapshot first (Phase 0 safety net);
   *   • merges the server response into local cache + re-runs the
   *     forward mapper so the UI sees the canonical post-push state;
   *   • clears successfully-pushed entries from the local overlay
   *     (the edit is now part of cloud truth, no need to apply it again).
   *
   * Returns `PushResult` describing how many went through and what was
   * skipped (with reasons). Throws on transport / auth errors so the
   * caller can surface an inline message.
   */
  pushPendingEdits: () => Promise<PushResult>;

  /** Persist the auto-sync settings. Enable/disable + interval. */
  setAutoSync: (
    enabled: boolean,
    value: number,
    unit: AutoSyncUnit
  ) => Promise<void>;
  /** Wake-up tick from the App-level poller. Returns true if a sync
   *  fired (so logs can attribute it as auto), false otherwise.
   *  Bails out fast when disabled / no token / sync already in flight. */
  runAutoSyncIfDue: () => Promise<boolean>;
}

export const useZenmoneyStore = create<ZenmoneyState>((set, get) => ({
  token: null,
  serverTimestamp: 0,
  lastSyncAt: null,
  status: "idle",
  error: null,
  loaded: false,
  pushMode: PUSH_MODE_DEFAULT,
  pushEnabled: false,
  lastPushAt: null,
  pushStatus: "idle",
  pushError: null,
  lastPushResult: null,
  snapshotPolicy: SNAPSHOT_POLICY_DEFAULT,
  autoSyncEnabled: false,
  autoSyncValue: AUTO_SYNC_VALUE_DEFAULT,
  autoSyncUnit: AUTO_SYNC_UNIT_DEFAULT,

  hydrate: async () => {
    const [
      token,
      ts,
      last,
      pushEnabled,
      pushMode,
      lastPushAt,
      snapshotPolicy,
      autoSyncEnabled,
      autoSyncValue,
      autoSyncUnit,
    ] = await Promise.all([
      db.loadJSON<string>(TOKEN_KEY),
      db.loadJSON<number>(TIMESTAMP_KEY),
      db.loadJSON<string>(LAST_SYNC_KEY),
      db.loadJSON<boolean>(PUSH_ENABLED_KEY),
      db.loadJSON<PushMode>(PUSH_MODE_KEY),
      db.loadJSON<string>(LAST_PUSH_KEY),
      db.loadJSON<SnapshotPolicy>(SNAPSHOT_POLICY_KEY),
      db.loadJSON<boolean>(AUTO_SYNC_ENABLED_KEY),
      db.loadJSON<number>(AUTO_SYNC_VALUE_KEY),
      db.loadJSON<AutoSyncUnit>(AUTO_SYNC_UNIT_KEY),
    ]);
    // Migration: callers from the boolean-toggle era stored
    // `pushEnabled: true` without a mode. Treat that as "manual" so
    // their behaviour is unchanged after the upgrade.
    const resolvedMode: PushMode =
      pushMode || (pushEnabled === true ? "manual" : PUSH_MODE_DEFAULT);
    set({
      token: token || null,
      serverTimestamp: ts || 0,
      lastSyncAt: last || null,
      pushMode: resolvedMode,
      pushEnabled: resolvedMode !== "off",
      lastPushAt: lastPushAt || null,
      snapshotPolicy: snapshotPolicy || SNAPSHOT_POLICY_DEFAULT,
      autoSyncEnabled: autoSyncEnabled === true,
      autoSyncValue:
        typeof autoSyncValue === "number" && autoSyncValue > 0
          ? autoSyncValue
          : AUTO_SYNC_VALUE_DEFAULT,
      autoSyncUnit: autoSyncUnit || AUTO_SYNC_UNIT_DEFAULT,
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
    const startedAt = Date.now();
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
      // Log the result. Full vs incremental + non-zero deltas drive
      // the human-readable summary in the log row.
      const deltaTx = diff.transaction?.length || 0;
      const deltaDel = diff.deletion?.length || 0;
      const summary = isFull
        ? `Полная синхронизация: ${formatNum(mapped.transactions.length)} операций`
        : deltaTx === 0 && deltaDel === 0
          ? `Без изменений (всего ${formatNum(mapped.transactions.length)})`
          : `+${formatNum(deltaTx)} новых/изменённых${deltaDel > 0 ? `, ${formatNum(deltaDel)} удалено` : ""}`;
      void useSyncLogStore.getState().append({
        kind: "pull",
        status: "ok",
        title: isFull ? "Полная синхронизация" : "Синхронизация",
        summary,
        details: {
          counts: {
            transactions: deltaTx,
            deletions: deltaDel,
            total: mapped.transactions.length,
          },
        },
        durationMs: Date.now() - startedAt,
      });
      // "on-sync" push mode: piggy-back outgoing edits on every sync.
      // Fire-and-forget — the push has its own status / log entry, and
      // we don't want a failed push to taint the sync's return value.
      // Guarded by `useEditsStore` having anything to send so the
      // common "nothing changed locally" case stays a no-op.
      if (
        get().pushMode === "on-sync" &&
        (Object.keys(useEditsStore.getState().edits).length > 0 ||
          useDeletedStore.getState().deletedIds.length > 0)
      ) {
        // Defer to next microtask so the sync's set() lands first and
        // pushPendingEdits sees `status: "ok"` (its own guard).
        queueMicrotask(() => {
          void get().pushPendingEdits().catch(() => {
            /* logged + surfaced inside pushPendingEdits */
          });
        });
      }
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
      void useSyncLogStore.getState().append({
        kind: "pull",
        status: "error",
        title: opts.force ? "Полная синхронизация" : "Синхронизация",
        summary: "Не удалось синхронизировать",
        error: msg,
        durationMs: Date.now() - startedAt,
      });
      throw e;
    }
  },

  setPushMode: async (mode) => {
    // Persist both the new mode key AND the legacy boolean so older
    // builds (or a downgrade) still see push as on/off correctly.
    await Promise.all([
      db.saveJSON(PUSH_MODE_KEY, mode),
      db.saveJSON(PUSH_ENABLED_KEY, mode !== "off"),
    ]);
    set({ pushMode: mode, pushEnabled: mode !== "off", pushError: null });
  },

  setSnapshotPolicy: async (policy) => {
    await db.saveJSON(SNAPSHOT_POLICY_KEY, policy);
    set({ snapshotPolicy: policy });
  },

  pushPendingEdits: async () => {
    const { token, pushEnabled } = get();
    if (!token) {
      const msg = "Сначала подключите токен";
      set({ pushStatus: "error", pushError: msg });
      throw new Error(msg);
    }
    if (!pushEnabled) {
      const msg = "Двусторонняя синхронизация выключена в настройках";
      set({ pushStatus: "error", pushError: msg });
      throw new Error(msg);
    }
    set({ pushStatus: "syncing", pushError: null });
    const pushStartedAt = Date.now();
    try {
      // 1) Phase 0 safety net — snapshot what's in cloud right before
      //    we touch anything. Frequency depends on `snapshotPolicy`:
      //      • "always" → every push (slow but bulletproof; debug-mode)
      //      • "daily"  → only if no snapshot in the last 24h
      //      • "never"  → user opted out; they take manual snapshots
      //    If push misbehaves, the most recent snapshot is the rollback
      //    source of truth.
      let snapshotId: string | null = null;
      const policy = get().snapshotPolicy;
      let shouldSnapshot = false;
      if (policy === "always") {
        shouldSnapshot = true;
      } else if (policy === "daily") {
        const idx = await loadSnapshotIndex();
        const newest = idx[0]; // sorted newest first by loadSnapshotIndex
        shouldSnapshot =
          !newest || Date.now() - newest.createdAt >= DAILY_WINDOW_MS;
        // Surface the most-recent snapshot id even when we skipped
        // taking a new one — the UI can show "snapshot already exists"
        // rather than blank.
        if (!shouldSnapshot && newest) snapshotId = newest.id;
      }
      if (shouldSnapshot) {
        try {
          const snap = await takeSnapshot(token);
          snapshotId = snap.id;
        } catch (e) {
          // Snapshot failure shouldn't strand the user — log to console
          // but proceed with the push. The risk is bounded: Phase 1 only
          // updates existing transactions and we have the recent cache.
          console.warn("Pre-push snapshot failed:", e);
        }
      }

      // 2) Build push items from the current overlay.
      const cache = await loadZenCache();
      if (!cache) {
        const msg = "Локальный кэш Zenmoney пуст — сначала синхронизируйтесь";
        set({ pushStatus: "error", pushError: msg });
        throw new Error(msg);
      }
      const edits = useEditsStore.getState().edits;
      const { toPush, skipped } = buildPushItems(edits, cache);
      // Locally-deleted transactions → cloud `deletion` entries. Only
      // ids still present in cache produce a deletion (see buildDeletions).
      const deletions = buildDeletions(
        useDeletedStore.getState().deletedIds,
        cache
      );
      if (toPush.length === 0 && deletions.length === 0) {
        const result: PushResult = { pushed: 0, skipped, snapshotId };
        set({
          pushStatus: "ok",
          pushError: null,
          lastPushResult: result,
        });
        // Even no-op pushes go to the log — useful to confirm "I clicked
        // sync, what happened?" when there's nothing to send.
        void useSyncLogStore.getState().append({
          kind: "push",
          status: skipped.length > 0 ? "partial" : "ok",
          title: "Push в облако",
          summary:
            skipped.length > 0
              ? `Нет изменений для отправки. Пропущено: ${skipped.length}`
              : "Нет изменений для отправки",
          details: {
            counts: {
              accepted: 0,
              skipped: skipped.length,
              total: cache.transactions.length,
            },
            skipped,
          },
          durationMs: Date.now() - pushStartedAt,
        });
        return result;
      }

      // 3) Send to /v8/diff/. Server applies last-write-wins by `changed`,
      //    returns the saved entities (with possibly bumped `changed`) and
      //    its current `serverTimestamp`. Deletions ride along in the same
      //    request body.
      const response = await sendPush(
        token,
        get().serverTimestamp,
        toPush,
        deletions
      );

      // 4) Merge server response into local cache so subsequent diffs
      //    are anchored to the post-push state. `applyDiff` handles
      //    upserts + deletions identically for push echoes and regular
      //    pulls — the same shape comes back.
      const nextCache = applyDiff(cache, response);
      await saveZenCache(nextCache);
      const mapped = mapZenmoneyDiff(cacheToDiffResponse(nextCache));

      // 5) Clear successfully-pushed edits from the overlay. The edit's
      //    intent now lives in cloud truth (and in our cache), so
      //    applying it on top again would be a no-op at best, or worse
      //    re-introduce a stale value if cloud later changes the field.
      for (const item of toPush) {
        await useEditsStore.getState().clearEdit(item.id);
      }

      // 6) Refresh main data store. Same pattern as `sync`, minus
      //    calibration (push doesn't move account balances locally).
      const importMeta: ImportMeta = {
        importedAt: new Date().toISOString(),
        fileName: `Zen-мани API · ${mapped.accountsActive} счетов · ${mapped.tagsTotal} тегов`,
        totalRows: nextCache.transactions.length,
        parsed: mapped.transactions.length,
        skipped: nextCache.transactions.length - mapped.transactions.length,
        source: "api",
      };
      await useCategoryMetaStore.getState().setAll(mapped.categoryMeta);
      await db.saveRates(mapped.rates);
      useDataStore.setState({ rates: mapped.rates });
      await useDataStore.getState().setTransactions(mapped.transactions, importMeta);

      const nowIso = new Date().toISOString();
      await db.saveJSON(TIMESTAMP_KEY, response.serverTimestamp);
      await db.saveJSON(LAST_PUSH_KEY, nowIso);
      const result: PushResult = {
        pushed: toPush.length,
        skipped,
        snapshotId,
      };
      set({
        serverTimestamp: response.serverTimestamp,
        lastPushAt: nowIso,
        pushStatus: "ok",
        pushError: null,
        lastPushResult: result,
      });
      const parts: string[] = [];
      if (toPush.length > 0)
        parts.push(`Отправлено: ${formatNum(toPush.length)}`);
      if (deletions.length > 0)
        parts.push(`Удалено: ${formatNum(deletions.length)}`);
      if (skipped.length > 0)
        parts.push(`Пропущено: ${formatNum(skipped.length)}`);
      void useSyncLogStore.getState().append({
        kind: "push",
        status: skipped.length > 0 ? "partial" : "ok",
        title: "Push в облако",
        summary: parts.join(", ") || "Push в облако",
        details: {
          counts: {
            accepted: toPush.length,
            skipped: skipped.length,
            total: mapped.transactions.length,
          },
          skipped,
        },
        durationMs: Date.now() - pushStartedAt,
      });
      return result;
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
        msg = "Не удалось отправить правки в облако";
      }
      set({ pushStatus: "error", pushError: msg });
      void useSyncLogStore.getState().append({
        kind: "push",
        status: "error",
        title: "Push в облако",
        summary: "Ошибка отправки правок",
        error: msg,
        durationMs: Date.now() - pushStartedAt,
      });
      throw e;
    }
  },

  setAutoSync: async (enabled, value, unit) => {
    const v = Math.max(1, Math.floor(value));
    await Promise.all([
      db.saveJSON(AUTO_SYNC_ENABLED_KEY, enabled),
      db.saveJSON(AUTO_SYNC_VALUE_KEY, v),
      db.saveJSON(AUTO_SYNC_UNIT_KEY, unit),
    ]);
    set({ autoSyncEnabled: enabled, autoSyncValue: v, autoSyncUnit: unit });
  },

  runAutoSyncIfDue: async () => {
    const s = get();
    // Gate-rails: no token / not enabled / mid-sync ⇒ do nothing.
    if (!s.token || !s.autoSyncEnabled) return false;
    if (s.status === "syncing" || s.status === "checking") return false;
    const intervalMs = autoSyncToMs(s.autoSyncValue, s.autoSyncUnit);
    const lastMs = s.lastSyncAt ? new Date(s.lastSyncAt).getTime() : 0;
    if (Date.now() - lastMs < intervalMs) return false;
    try {
      await get().sync();
      return true;
    } catch {
      // sync() already wrote the failure to the log + set error state;
      // we just need to swallow here so the poller doesn't crash.
      return false;
    }
  },
}));
