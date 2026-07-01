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
  buildBudgetPush,
  buildDeletions,
  buildResurrections,
  buildTagPush,
  detectConflicts,
  sendPush,
  validateDrafts,
  type PushBuildResult,
} from "../lib/zenmoneyPush";
import { useTagEditsStore, loadTagEdits } from "./useTagEditsStore";
import { useBudgetEditsStore, loadBudgetEdits } from "./useBudgetEditsStore";
import { useDraftsStore, loadDrafts } from "./useDraftsStore";
import { loadSnapshotIndex, takeSnapshot } from "../lib/cloudSnapshots";
import { useDataStore } from "./useDataStore";
import { useCalibrationStore } from "./useCalibrationStore";
import { useOffBalanceStore } from "./useOffBalanceStore";
import { toBase } from "../lib/csv";
import { useCategoryMetaStore } from "./useCategoryMetaStore";
import { useEditsStore } from "./useEditsStore";
import { useDeletedStore } from "./useDeletedStore";
import {
  useDeletedPayloadsStore,
  loadDeletedPayloads,
} from "./useDeletedPayloadsStore";
import { useSyncLogStore } from "./useSyncLogStore";
import { useBudgetsStore } from "./useBudgetsStore";
import { zenPlanList } from "../lib/zenBudgets";
import { formatNum } from "../lib/format";
import type { ImportMeta } from "../types";
import {
  isProviderActive,
  fetchProviderToken,
  redirectToLogin,
  postLogout,
  wipeLocalDb,
  shouldWipeForUser,
  shouldAutoConnectProvider,
} from "../lib/authProvider";

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
// Set when the user explicitly disconnects from the SSO provider. Blocks the
// silent boot-time auto-connect so a still-live session cookie can't re-adopt
// the account on the next reload. Cleared when the user opts back in via login.
const PROVIDER_OPT_OUT_KEY = "zenmoneyProviderOptOut";

/**
 * Overlay pending tag edits onto a freshly-mapped `categoryMeta` map so a
 * not-yet-pushed «обязательная» change survives a re-map (sync/push rebuild
 * meta from the cache, which still holds the old value until the edit lands
 * in the cloud). Tag edits are keyed by tag id; meta by category title — we
 * resolve via the cache tags. Mutates and returns `meta`.
 */
function overlayTagEdits<M extends { required?: boolean | null }>(
  meta: Record<string, M>,
  edits: Record<string, { required: boolean | null }>,
  cacheTags: { id: string; title: string; parent: string | null }[]
): Record<string, M> {
  if (Object.keys(edits).length === 0) return meta;
  // Only TOP-LEVEL tags map to a categoryMeta key. Sub-tag edits push to the
  // cloud but never feed the 50/30/20 split, so skip them here.
  const rootTitleById = new Map(
    cacheTags.filter((t) => !t.parent).map((t) => [t.id, t.title])
  );
  for (const [id, edit] of Object.entries(edits)) {
    const title = rootTitleById.get(id);
    if (!title) continue;
    const cur = meta[title];
    if (cur) meta[title] = { ...cur, required: edit.required };
  }
  return meta;
}

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
  /** True when the user marked this account as a savings account in Zenmoney.
   *  Independent of `inBalance` — a savings account can be in or out of balance. */
  savings: boolean;
  /** Opening balance (native currency) — the money on the account before any
   *  recorded transaction. Needed to reconstruct net worth over time. */
  startBalance: number;
  /** ISO date the account was opened, or null. Where the opening balance lands
   *  on the net-worth timeline (fallback: account's first transaction, else the
   *  global earliest date). */
  startDate: string | null;
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
    savings: a.savings,
    startBalance: a.startBalance || 0,
    startDate: a.startDate ?? null,
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

/** A category tag (root or sub-tag) for the «обязательная» editor. */
export interface CategoryTag {
  id: string;
  title: string;
  /** Parent tag id, or null for a top-level category. */
  parent: string | null;
  /** Zenmoney «обязательная» flag (null = not set). */
  required: boolean | null;
  /** Tag accepts income transactions. */
  showIncome: boolean;
  /** Tag accepts expense transactions. */
  showOutcome: boolean;
}

/**
 * Category tags from the Zenmoney cache for the «обязательная» editor — roots
 * AND their sub-tags (the editor nests them under their parent). Each tag's
 * own `required` is editable independently and pushes to the cloud; note the
 * 50/30/20 split classifies by the TOP-LEVEL category, so a sub-tag's flag
 * doesn't move the split. Returns null in CSV mode. Sorted by title (ru).
 */
export async function getCategoryTagsFromCache(): Promise<CategoryTag[] | null> {
  const cache = await loadZenCache();
  if (!cache) return null;
  return cache.tags
    .map((t) => ({
      id: t.id,
      title: t.title,
      parent: t.parent ?? null,
      required: t.required ?? null,
      showIncome: !!t.showIncome,
      showOutcome: !!t.showOutcome,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));
}

/**
 * Sum the current balances (in base currency) of the live accounts in cache,
 * honouring the global "include off-balance" setting. Archived accounts never
 * count. Used to anchor the net-worth calibration on sync and whenever the
 * off-balance setting changes.
 */
export async function recalcBalanceCalibration(): Promise<void> {
  const cache = await loadZenCache();
  if (!cache) return; // CSV mode — no live balances, manual calibration stays
  const include = useOffBalanceStore.getState().includeOffBalance;
  const rates = useDataStore.getState().rates;
  const instrById = new Map(cache.instruments.map((i) => [i.id, i]));
  const total = cache.accounts
    .filter((a) => !a.archive && (include || a.inBalance))
    .reduce((s, a) => {
      const cur = instrById.get(a.instrument)?.shortTitle || rates.base;
      return s + toBase(a.balance || 0, cur, rates);
    }, 0);
  const today = new Date().toISOString().slice(0, 10);
  await useCalibrationStore.getState().set({ date: today, amount: Math.round(total) });
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
  /** How many newly-created operations (drafts) were sent. */
  created: number;
  /** Edits that couldn't be pushed (with reasons). They stay in the local overlay. */
  skipped: PushBuildResult["skipped"];
  /** ISO timestamp of the snapshot we took right before sending — for audit. */
  snapshotId: string | null;
}

interface ZenmoneyState {
  token: string | null;
  /** True when the token came from the external provider (in-memory, not
   *  persisted). Drives the 401→login redirect and the "Подключено через
   *  zen-platform" UI. Stays false in manual-token / CSV mode. */
  providerMode: boolean;
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
   * Local disconnect from the SSO provider: drop the in-memory token and
   * persist an opt-out so the next boot does NOT silently re-fetch the token
   * by cookie. Keeps local data (mirrors `removeToken`'s "data stays"
   * contract); does NOT end the server-side SSO session — that's the auth
   * provider's own logout. Returns the user to the source-choice screen.
   */
  disconnectProvider: () => Promise<void>;
  /**
   * Full SSO logout: POST the logout endpoint to end the server-side session,
   * then (only on confirmed success) do the same local reset as
   * `disconnectProvider`. On failure leaves the session intact and surfaces an
   * error. Callers gate the button on `isLogoutConfigured()`. The opt-out is
   * set defensively so even a partial logout can't silently re-adopt the
   * session on the next boot.
   */
  logoutFromProvider: () => Promise<void>;
  /**
   * Opt back into the provider and go to login. Clears the opt-out first
   * (awaited, so the write lands before navigation) — otherwise the return
   * trip would skip auto-connect and look "broken".
   */
  loginViaProvider: () => Promise<void>;
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

/** In-flight guard for hydrate() — see the comment there. */
let hydrating = false;

/**
 * Resolve the Zenmoney `user.id` behind a token. Cheap incremental probe
 * first (most servers echo `user` regardless of serverTimestamp); falls
 * back to a full pull, which always carries it.
 * ponytail: the fallback full pull only fires if the API never echoes user
 * on an incremental diff — if that's the case, cache a user-id stamp to skip it.
 */
async function fetchProviderUserId(token: string): Promise<number | null> {
  const now = Math.floor(Date.now() / 1000);
  const inc = await fetchDiff(token, now);
  if (inc.user?.length) return inc.user[0].id;
  const full = await fetchDiff(token, 0);
  return full.user?.[0]?.id ?? null;
}

/**
 * Boot the provider session: fetch the token by cookie, then either show
 * the choice screen (no session), wipe+reload on a user switch, or set the
 * in-memory token and sync. Nothing is wiped unless the ZenMoney user id of
 * the new token differs from the locally-cached one.
 */
async function initProviderSession(): Promise<void> {
  const store = useZenmoneyStore;
  const token = await fetchProviderToken();
  if (!token) return; // 401 / no session → EmptyState shows the choice screen
  // Detect a user switch (explicit "переключить" OR an external change of
  // the shared session's active account) before adopting the token.
  const cache = await loadZenCache();
  const cachedId = cache?.user?.[0]?.id ?? null;
  if (cachedId != null) {
    try {
      const tokenId = await fetchProviderUserId(token);
      if (shouldWipeForUser(cachedId, tokenId)) {
        await wipeLocalDb(); // reloads; fresh full sync runs for the new user
        return;
      }
    } catch {
      // Couldn't determine the new user's id (network / bad token). Don't
      // wipe on uncertainty — fall through to sync, which redirects on 401.
    }
  }
  store.setState({ token, providerMode: true });
  try {
    await store.getState().sync(); // incremental if cache exists, else full
  } catch {
    /* surfaced in store state + sync log */
  }
}

export const useZenmoneyStore = create<ZenmoneyState>((set, get) => ({
  token: null,
  providerMode: false,
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
    // Two effects (App + ImportPage) both call hydrate guarded only by
    // `!loaded`, which flips asynchronously — guard the in-flight window
    // too so provider init (and its sync) can't fire twice.
    if (get().loaded || hydrating) return;
    hydrating = true;
    try {
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
      providerOptOut,
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
      db.loadJSON<boolean>(PROVIDER_OPT_OUT_KEY),
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
    // Priority: a persisted token means manual mode (upstream behaviour).
    // Otherwise, if the build wired up a provider AND the user hasn't
    // explicitly disconnected, try the SSO session.
    // ponytail: brief EmptyState flash while the background fetch+sync
    // runs is acceptable — not worth a dedicated loading gate.
    if (shouldAutoConnectProvider(isProviderActive(), !!token, providerOptOut === true)) {
      await initProviderSession();
    }
    } finally {
      hydrating = false;
    }
  },

  saveToken: async (token) => {
    const trimmed = token.trim();
    await db.saveJSON(TOKEN_KEY, trimmed);
    set({ token: trimmed, providerMode: false, error: null });
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
      set({ token: trimmed, providerMode: false, status: "idle", error: null });
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
      providerMode: false,
      serverTimestamp: 0,
      lastSyncAt: null,
      status: "idle",
      error: null,
    });
  },

  disconnectProvider: async () => {
    await db.saveJSON(PROVIDER_OPT_OUT_KEY, true);
    set({
      token: null,
      providerMode: false,
      status: "idle",
      error: null,
    });
  },

  logoutFromProvider: async () => {
    // End the server session first. Only reset local state on a confirmed
    // logout — otherwise we'd drop the user to the choice screen while still
    // logged in server-side, and the next boot would silently reconnect.
    const ok = await postLogout();
    if (!ok) {
      set({ error: "Не удалось выйти из zen-platform. Попробуйте ещё раз." });
      return;
    }
    await db.saveJSON(PROVIDER_OPT_OUT_KEY, true);
    set({ token: null, providerMode: false, status: "idle", error: null });
  },

  loginViaProvider: async () => {
    await db.saveJSON(PROVIDER_OPT_OUT_KEY, false);
    redirectToLogin();
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
      // Keep any not-yet-pushed «обязательная» edits visible across the re-map.
      overlayTagEdits(
        mapped.categoryMeta,
        await loadTagEdits(),
        nextCache.tags
      );
      await useCategoryMetaStore.getState().setAll(mapped.categoryMeta);

      // Persist the rates that came with the diff so the next session boots
      // with up-to-date Zenmoney rates.
      await db.saveRates(mapped.rates);
      // Update store rates as well so re-aggregation uses fresh numbers.
      useDataStore.setState({ rates: mapped.rates });
      await useDataStore.getState().setTransactions(mapped.transactions, meta);

      // Auto-calibration: the API exposes current real balance per account,
      // which CSV lacks. Anchor the "Совокупный баланс" chart/KPIs to the real
      // total (respecting the global "include off-balance" setting). Overwrites
      // any existing calibration since the API value is authoritative.
      await recalcBalanceCalibration();

      // On a FULL sync, mirror Zenmoney «Планы»/budgets into local budget
      // lines so they appear automatically (no manual import). Create-only:
      // categories the user already budgets are left untouched.
      if (isFull && nextCache.budgets && nextCache.budgets.length > 0) {
        // Mirror Zenmoney «Планы»/budgets for EVERY month they cover — each
        // category's line starts at its earliest planned month and carries a
        // per-month plan via overrides, so past months fill in too.
        const seeds = zenPlanList(nextCache.budgets, nextCache.tags);
        if (seeds.length > 0) {
          const bs = useBudgetsStore.getState();
          if (!bs.loaded) await bs.hydrate();
          await useBudgetsStore.getState().importFromZen(seeds);
        }
      }

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
      // Guarded by there being anything to send (edits, deletions OR
      // locally-created drafts) so the common "nothing changed locally"
      // case stays a no-op.
      if (
        get().pushMode === "on-sync" &&
        (Object.keys(useEditsStore.getState().edits).length > 0 ||
          useDeletedStore.getState().deletedIds.length > 0 ||
          Object.keys(useDraftsStore.getState().drafts).length > 0 ||
          Object.keys(useTagEditsStore.getState().edits).length > 0 ||
          Object.keys(useBudgetEditsStore.getState().edits).length > 0)
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
      // Provider mode: a 401 means the SSO session expired — send the user
      // to re-login instead of showing a dead-end inline error.
      if (e instanceof ZenApiError && e.status === 401 && get().providerMode) {
        redirectToLogin();
        throw e; // page is navigating away
      }
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
    // Switching to «auto» must flush whatever was queued while push was off or
    // manual. The auto-push debounce (App.tsx) only fires on a NEW edit, so
    // without this the backlog would sit until the next change — exactly the
    // «внёс правку при выключенном Push, включил Авто, ничего не ушло» case.
    // (manual → user pushes by hand; on-sync → flushes on the next sync.)
    if (mode === "auto") {
      const s = get();
      const hasPending =
        Object.keys(useEditsStore.getState().edits).length > 0 ||
        useDeletedStore.getState().deletedIds.length > 0 ||
        Object.keys(useDraftsStore.getState().drafts).length > 0 ||
        Object.keys(useTagEditsStore.getState().edits).length > 0 ||
        Object.keys(useBudgetEditsStore.getState().edits).length > 0;
      if (s.token && s.pushStatus !== "syncing" && hasPending) {
        void get().pushPendingEdits().catch(() => {
          /* surfaced via pushError + sync log */
        });
      }
    }
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
      let cache = await loadZenCache();
      if (!cache) {
        const msg = "Локальный кэш Zenmoney пуст — сначала синхронизируйтесь";
        set({ pushStatus: "error", pushError: msg });
        throw new Error(msg);
      }
      const edits = useEditsStore.getState().edits;

      // 2a) Conflict detection. Pull a fresh diff since our last sync and
      //     check whether any transaction we're about to edit was changed
      //     in the cloud meanwhile (e.g. on the phone). Such edits would
      //     clobber a newer remote version, so we skip them (and keep the
      //     local edit for a retry after the user reviews). Best-effort:
      //     if the fetch fails we fall back to pushing against the cache.
      let conflicts = new Set<string>();
      try {
        const fresh = await fetchDiff(token, cache.serverTimestamp);
        conflicts = detectConflicts(Object.keys(edits), cache, fresh.transaction);
        cache = applyDiff(cache, fresh); // adopt fresh cloud truth
        await saveZenCache(cache);
        set({ serverTimestamp: fresh.serverTimestamp });
        await db.saveJSON(TIMESTAMP_KEY, fresh.serverTimestamp);
      } catch {
        /* best-effort — push against the (possibly stale) cached state */
      }

      const built = buildPushItems(edits, cache);
      const conflictSkips = built.toPush
        .filter((i) => conflicts.has(i.id))
        .map((i) => ({
          id: i.id,
          reason:
            "операция изменена в облаке после последней синхронизации — обновите и повторите",
        }));
      // A locally-deleted row must NOT also be pushed as an edit/upsert — the
      // deletion wins (issue #19.4). Edits are cleared on delete, but guard here
      // too so an edit can never race a deletion into the same request.
      const deletedIds = useDeletedStore.getState().deletedIds;
      const deletedSet = new Set(deletedIds);
      const toPush = built.toPush.filter(
        (i) => !conflicts.has(i.id) && !deletedSet.has(i.id)
      );
      const skipped = [...built.skipped, ...conflictSkips];
      // Locally-deleted transactions → cloud `deletion` entries. Only
      // ids still present in cache produce a deletion (see buildDeletions).
      const deletions = buildDeletions(deletedIds, cache);
      // Restored transactions whose cloud row was already deleted → revive
      // them by re-creating under a NEW id (tombstones are sticky — see
      // buildResurrections).
      const resurrections = buildResurrections(
        await loadDeletedPayloads(),
        useDeletedStore.getState().deletedIds,
        cache,
        Math.floor(Date.now() / 1000)
      );
      // Locally-created drafts (new operations not yet in the cloud). Each
      // is a complete ZenTransaction; validate references against the fresh
      // cache and re-stamp `changed`. They ride along in the same request.
      const draftPush = validateDrafts(
        await loadDrafts(),
        cache,
        Math.floor(Date.now() / 1000)
      );
      const draftTxs = draftPush.ready;
      // Draft "skips" don't keep a row in limbo: an "already in cloud" draft
      // is stale (the cleanup below drops it); other reasons go to the log.
      skipped.push(...draftPush.skipped);
      // Pending category-tag edits (the «обязательная» flag). Built against
      // the fresh cache; no-ops and unresolvable ids are skipped.
      const tagEdits = await loadTagEdits();
      const tagPush = buildTagPush(
        tagEdits,
        cache.tags,
        Math.floor(Date.now() / 1000)
      );
      const tagSkips = tagPush.skipped.map((s) => ({
        id: s.id,
        reason: s.reason,
      }));
      skipped.push(...tagSkips);
      // Pending plan/budget changes → ZenBudget upserts. Built against the
      // fresh cache so the (tag, month) cell and its «other side» are current.
      const budgetEdits = await loadBudgetEdits();
      const budgetPush = buildBudgetPush(
        Object.values(budgetEdits),
        cache.budgets ?? [],
        cache.tags,
        Math.floor(Date.now() / 1000)
      );
      skipped.push(...budgetPush.skipped);
      // Budget edits that aren't skipped are satisfied — either sent below, or a
      // no-op because the cloud already matches. Either way the local intent is
      // done, so they must leave the queue (clear the «ждёт отправки» arrow) in
      // BOTH the normal push path AND the «nothing to send» early-return — else
      // a no-op edit's arrow would stick forever.
      const skippedBudgetIds = new Set(budgetPush.skipped.map((s) => s.id));
      const doneBudgetIds = Object.keys(budgetEdits).filter(
        (id) => !skippedBudgetIds.has(id)
      );
      if (
        toPush.length === 0 &&
        deletions.length === 0 &&
        resurrections.length === 0 &&
        draftTxs.length === 0 &&
        tagPush.tags.length === 0 &&
        budgetPush.budgets.length === 0
      ) {
        const result: PushResult = { pushed: 0, created: 0, skipped, snapshotId };
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
        // Drop no-op budget edits even though we sent nothing — their cloud
        // value already matches, so the «ждёт отправки» arrow should clear.
        if (doneBudgetIds.length > 0) {
          await useBudgetEditsStore.getState().clearMany(doneBudgetIds);
        }
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
        deletions,
        [...resurrections.map((r) => r.tx), ...draftTxs],
        tagPush.tags,
        budgetPush.budgets
      );

      // 4) Merge server response into local cache so subsequent diffs
      //    are anchored to the post-push state.
      //
      //    IMPORTANT: the Zenmoney `/v8/diff/` response does NOT echo back the
      //    deletions WE just sent — its `deletion` array only reports rows
      //    deleted by OTHER clients since our `serverTimestamp`. So without
      //    folding our own (now server-accepted) deletions into the merge, the
      //    just-deleted rows stay LIVE in the local cache until the next full
      //    sync pulls the tombstone. That made a pushed deletion keep showing
      //    as «Удалено» in the pending-changes list and keep the pending badge
      //    lit, as if it never synced. The push returned 200 → the server
      //    accepted these deletions → apply them to the cache now. (Idempotent:
      //    if the server ever DID echo them, `applyDeletions` dedups by id.)
      const nextCache = applyDiff(cache, {
        ...response,
        deletion: [...(response.deletion ?? []), ...deletions],
      });
      await saveZenCache(nextCache);

      // Prune snapshots that are no longer needed:
      //   • the resurrected `oldId`s — re-created under a new id, so the
      //     snapshot is spent (and keeping it would dup on the next push);
      //   • ids back in the cloud + not hidden locally (deletion was never
      //     pushed, so the original is still live).
      {
        const deletedNow = new Set(useDeletedStore.getState().deletedIds);
        const liveInCacheNow = new Set(
          nextCache.transactions
            .filter((t) => !t.deleted)
            .map((t) => String(t.id))
        );
        const prune = new Set(resurrections.map((r) => r.oldId));
        for (const id of Object.keys(await loadDeletedPayloads())) {
          if (liveInCacheNow.has(id) && !deletedNow.has(id)) prune.add(id);
        }
        if (prune.size > 0) {
          await useDeletedPayloadsStore.getState().removeMany([...prune]);
        }
      }
      const mapped = mapZenmoneyDiff(cacheToDiffResponse(nextCache));

      // 5) Clear successfully-pushed edits from the overlay. The edit's
      //    intent now lives in cloud truth (and in our cache), so
      //    applying it on top again would be a no-op at best, or worse
      //    re-introduce a stale value if cloud later changes the field.
      for (const item of toPush) {
        await useEditsStore.getState().clearEdit(item.id);
      }

      // 5b) Drop drafts that now live in the cloud (sent + echoed, or stale
      //     ones that were already there). The mapper re-creates them from
      //     the cache, so keeping the draft would double the row.
      {
        const liveNow = new Set(
          nextCache.transactions
            .filter((t) => !t.deleted)
            .map((t) => String(t.id))
        );
        const sentIds = Object.keys(await loadDrafts()).filter((id) =>
          liveNow.has(id)
        );
        if (sentIds.length > 0) {
          await useDraftsStore.getState().clearMany(sentIds);
        }
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
      // Tag edits that were sent now live in cloud truth + our cache — drop
      // them from the overlay (same reasoning as transaction edits). Any
      // unresolved/no-op ones that remain are overlaid below so the UI keeps
      // showing the intended value until a re-sync resolves them.
      const sentTagIds = tagPush.tags.map((t) => String(t.id));
      if (sentTagIds.length > 0) {
        await useTagEditsStore.getState().clearMany(sentTagIds);
      }
      // Budget edits: clear everything that was sent OR a no-op (already in
      // cloud); keep only the ones we skipped (tag not in cache) for retry.
      // `doneBudgetIds` was computed up-front so the early-return path clears
      // the same set.
      if (doneBudgetIds.length > 0) {
        await useBudgetEditsStore.getState().clearMany(doneBudgetIds);
      }
      overlayTagEdits(
        mapped.categoryMeta,
        useTagEditsStore.getState().edits,
        nextCache.tags
      );
      await useCategoryMetaStore.getState().setAll(mapped.categoryMeta);
      await db.saveRates(mapped.rates);
      useDataStore.setState({ rates: mapped.rates });
      await useDataStore.getState().setTransactions(mapped.transactions, importMeta);

      const nowIso = new Date().toISOString();
      await db.saveJSON(TIMESTAMP_KEY, response.serverTimestamp);
      await db.saveJSON(LAST_PUSH_KEY, nowIso);
      const result: PushResult = {
        pushed: toPush.length,
        created: draftTxs.length,
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
      if (draftTxs.length > 0)
        parts.push(`Создано: ${formatNum(draftTxs.length)}`);
      if (deletions.length > 0)
        parts.push(`Удалено: ${formatNum(deletions.length)}`);
      if (resurrections.length > 0)
        parts.push(`Восстановлено в облаке: ${formatNum(resurrections.length)}`);
      if (tagPush.tags.length > 0)
        parts.push(`Категорий обновлено: ${formatNum(tagPush.tags.length)}`);
      if (skipped.length > 0)
        parts.push(
          `Пропущено: ${formatNum(skipped.length)}` +
            (conflictSkips.length > 0
              ? ` (конфликтов: ${formatNum(conflictSkips.length)})`
              : "")
        );
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
      if (e instanceof ZenApiError && e.status === 401 && get().providerMode) {
        redirectToLogin();
        throw e; // page is navigating away
      }
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
