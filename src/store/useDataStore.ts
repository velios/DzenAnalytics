import { create } from "zustand";
import type { Transaction, CurrencyRates, ImportMeta } from "../types";
import * as db from "../lib/db";
import { toBase } from "../lib/csv";
import { buildPayeeAliasMap } from "../lib/payeeNormalize";
import { applyCategoryRules, type CategoryRule } from "./useCategoryRulesStore";
import { applyEdits } from "../lib/applyEdits";
import { useEditsStore } from "./useEditsStore";
import { useDeletedStore, loadDeletedSet } from "./useDeletedStore";
import { useDeletedPayloadsStore } from "./useDeletedPayloadsStore";
import { loadZenCache } from "../lib/zenmoneyCache";
import type { ZenTransaction } from "../lib/zenmoney";
import { aliasesToMap, type PayeeAlias } from "./usePayeeAliasStore";

// Rough cross-rates relative to RUB — purely a starting point so the rates UI
// is populated out of the box. Users adjust to their own actual rates.
const DEFAULT_RATES: CurrencyRates = {
  base: "RUB",
  rates: {
    RUB: 1,
    USD: 90,
    EUR: 95,
    GBP: 110,
    CNY: 12.5,
    JPY: 0.6,
    KZT: 0.18,
    BYN: 28,
    GEL: 33,
    AMD: 0.23,
    AED: 24,
    TRY: 2.4,
    THB: 2.5,
  },
};

function mergeRatesWithDefaults(saved: CurrencyRates | null): CurrencyRates {
  if (!saved) return DEFAULT_RATES;
  // Keep user's values, but add any default currencies they don't have yet.
  return {
    base: saved.base,
    rates: { ...DEFAULT_RATES.rates, ...saved.rates },
  };
}

function ensureCurrenciesInRates(rates: CurrencyRates, txs: Transaction[]): CurrencyRates {
  const known = new Set(Object.keys(rates.rates));
  const next = { ...rates.rates };
  let changed = false;
  for (const t of txs) {
    for (const c of [t.currency, t.outcomeCurrency, t.incomeCurrency]) {
      if (c && !known.has(c)) {
        next[c] = 1;
        known.add(c);
        changed = true;
      }
    }
  }
  return changed ? { ...rates, rates: next } : rates;
}

interface DataState {
  /** Post-rules transactions with user edits applied. This is what charts/pages render. */
  transactions: Transaction[];
  /**
   * Post-rules transactions WITHOUT user edits applied. Mirrors what's in IDB.
   * Pipeline actions always start from this so edits don't compound and so
   * `clearEdit` can correctly revert to original values.
   */
  transactionsRaw: Transaction[];
  rates: CurrencyRates;
  importMeta: ImportMeta | null;
  payeeGroupingEnabled: boolean;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setTransactions: (txs: Transaction[], meta: ImportMeta) => Promise<void>;
  mergeTransactions: (
    incoming: Transaction[],
    meta: ImportMeta
  ) => Promise<{ added: number; duplicates: number }>;
  clearAll: () => Promise<void>;
  setRate: (currency: string, value: number) => Promise<void>;
  setBase: (newBase: string) => Promise<void>;
  setPayeeGrouping: (enabled: boolean) => Promise<void>;
  reapplyRules: () => Promise<void>;
  /** Hide a transaction locally (soft-delete) and recompute the
   *  visible list. Cloud-side deletion (when push is on) is handled
   *  separately by the Zenmoney store's push path. */
  deleteTransaction: (id: string) => Promise<void>;
  /** Hide many transactions at once (one recompute). */
  deleteTransactionMany: (ids: string[]) => Promise<void>;
  /** Un-hide a previously deleted transaction. */
  restoreTransaction: (id: string) => Promise<void>;
  /** Un-hide many at once (one recompute). */
  restoreTransactionMany: (ids: string[]) => Promise<void>;
}

function recalcBase(txs: Transaction[], rates: CurrencyRates): Transaction[] {
  return txs.map((t) => ({ ...t, amountBase: toBase(t.amount, t.currency, rates) }));
}

/**
 * The last step of the transactions pipeline: apply the user's edit
 * overlay, then drop any locally-deleted (hidden) rows. Everything that
 * sets `transactions` goes through here so the deletion filter is
 * impossible to forget at a call site.
 */
async function finalize(
  raw: Transaction[],
  rates: CurrencyRates
): Promise<Transaction[]> {
  const withEdits = applyEdits(raw, await loadEditsFromStore(), rates);
  const deleted = await loadDeletedSet();
  if (deleted.size === 0) return withEdits;
  return withEdits.filter((t) => !deleted.has(t.id));
}

/**
 * API mode only: stash the full Zenmoney payload of the given ids before
 * a cloud deletion purges them from cache, so a later restore can revive
 * them in the cloud. Best-effort — a snapshot failure never blocks the
 * (local) delete.
 */
async function snapshotForCloudRestore(ids: string[]): Promise<void> {
  try {
    const cache = await loadZenCache();
    if (!cache) return; // CSV mode — no cloud to restore to
    const byId = new Map(cache.transactions.map((t) => [String(t.id), t]));
    const found: ZenTransaction[] = [];
    for (const id of ids) {
      const zt = byId.get(id);
      if (zt && !zt.deleted) found.push(zt);
    }
    if (found.length > 0) {
      await useDeletedPayloadsStore.getState().saveMany(found);
    }
  } catch {
    /* best-effort */
  }
}

/**
 * After a restore, push so the resurrection reaches the cloud right away.
 * Restoring a cloud-deleted row inherently needs a cloud write (the row is
 * re-created there), and it's an explicit user action — so we push under
 * ANY two-way mode, not just "auto". A no-op when there's nothing to
 * resurrect. Dynamic import avoids a static cycle with useZenmoneyStore.
 */
async function pushAfterRestore(): Promise<void> {
  try {
    const { useZenmoneyStore } = await import("./useZenmoneyStore");
    const zen = useZenmoneyStore.getState();
    if (zen.pushMode !== "off" && zen.token && zen.pushStatus !== "syncing") {
      await zen.pushPendingEdits();
    }
  } catch {
    /* surfaced via pushError + sync log */
  }
}

async function loadRules(): Promise<CategoryRule[]> {
  const data = await db.loadJSON<CategoryRule[]>("categoryRules");
  return data || [];
}

async function loadEditsFromStore(): Promise<
  Record<string, import("./useEditsStore").TransactionEdit>
> {
  // Prefer the in-memory copy (set by hydrate); fall back to disk for the
  // very first call before any store hydration ran.
  const mem = useEditsStore.getState().edits;
  if (Object.keys(mem).length > 0 || useEditsStore.getState().loaded) return mem;
  const disk = await db.loadJSON<
    Record<string, import("./useEditsStore").TransactionEdit>
  >("transactionEdits");
  return disk || {};
}

/** Read the user's manual payee aliases straight from IDB, so this
 *  module doesn't depend on the React component lifecycle. */
async function loadManualAliasesFromStore(): Promise<PayeeAlias[]> {
  const data = await db.loadJSON<PayeeAlias[]>("payeeAliases");
  return Array.isArray(data) ? data : [];
}

/**
 * Apply payee-grouping pipeline:
 *   1. Restore every tx's `payee` to `payeeOriginal` (clean slate).
 *   2. If auto-grouping is enabled, run the fuzzy alias detector
 *      and map variants to their canonical representative.
 *   3. Apply the user's manual aliases on top — these always win,
 *      so the user can pin down anything fuzzy missed (or override
 *      it when it grouped too eagerly).
 */
function applyPayeeGrouping(
  txs: Transaction[],
  enabled: boolean,
  manualAliases: PayeeAlias[] = []
): Transaction[] {
  // Step 1 — restore originals.
  let out = txs.map((t) =>
    t.payeeOriginal ? { ...t, payee: t.payeeOriginal } : t
  );

  // Step 2 — fuzzy auto-grouping (only when toggle is on).
  if (enabled) {
    const allPayees = out.map((t) => t.payee).filter(Boolean);
    const aliases = buildPayeeAliasMap(allPayees);
    if (aliases.size > 0) {
      out = out.map((t) => {
        const canonical = aliases.get(t.payee);
        return canonical ? { ...t, payee: canonical } : t;
      });
    }
  }

  // Step 3 — manual aliases (curated by the user), always applied.
  // Match by the current (post-auto) payee first — that's a "rename the
  // whole group" rule. Fall back to the ORIGINAL payee so a manual
  // override of a single auto-grouped name works too (the auto-grouping
  // table lets the user retarget one original without touching the rest
  // of its group). Post-auto match wins so existing group-level rules
  // keep their meaning.
  if (manualAliases.length > 0) {
    const manual = aliasesToMap(manualAliases);
    out = out.map((t) => {
      const next =
        manual.get(t.payee) ??
        (t.payeeOriginal ? manual.get(t.payeeOriginal) : undefined);
      return next ? { ...t, payee: next } : t;
    });
  }

  return out;
}

export const useDataStore = create<DataState>((set, get) => ({
  transactions: [],
  transactionsRaw: [],
  rates: DEFAULT_RATES,
  importMeta: null,
  payeeGroupingEnabled: false,
  loaded: false,

  hydrate: async () => {
    const [txs, savedRates, meta, grouping, rules, manualAliases] = await Promise.all([
      db.loadTransactions(),
      db.loadRates(),
      db.loadImportMeta(),
      db.loadJSON<boolean>("payeeGrouping"),
      loadRules(),
      loadManualAliasesFromStore(),
    ]);
    const rates = mergeRatesWithDefaults(savedRates);
    let raw = recalcBase(txs, rates);
    raw = applyPayeeGrouping(raw, grouping || false, manualAliases);
    raw = applyCategoryRules(raw, rules);
    const final = await finalize(raw, rates);
    set({
      transactions: final,
      transactionsRaw: raw,
      rates,
      importMeta: meta,
      payeeGroupingEnabled: grouping || false,
      loaded: true,
    });
  },

  setTransactions: async (txs, meta) => {
    const { payeeGroupingEnabled } = get();
    const rates = ensureCurrenciesInRates(get().rates, txs);
    if (rates !== get().rates) await db.saveRates(rates);
    const rules = await loadRules();
    const manualAliases = await loadManualAliasesFromStore();
    let raw = recalcBase(txs, rates);
    raw = applyPayeeGrouping(raw, payeeGroupingEnabled, manualAliases);
    raw = applyCategoryRules(raw, rules);
    await db.saveTransactions(raw);
    await db.saveImportMeta(meta);
    const final = await finalize(raw, rates);
    set({ transactions: final, transactionsRaw: raw, rates, importMeta: meta });
  },

  mergeTransactions: async (incoming, meta) => {
    const { payeeGroupingEnabled, transactionsRaw: existing } = get();
    const rates = ensureCurrenciesInRates(get().rates, incoming);
    if (rates !== get().rates) await db.saveRates(rates);
    const rules = await loadRules();
    const manualAliases = await loadManualAliasesFromStore();
    const existingIds = new Set(existing.map((t) => t.id));
    const fresh = incoming.filter((t) => !existingIds.has(t.id));
    const combined = [...existing, ...fresh];
    let raw = recalcBase(combined, rates);
    raw = applyPayeeGrouping(raw, payeeGroupingEnabled, manualAliases);
    raw = applyCategoryRules(raw, rules);
    await db.saveTransactions(raw);
    const mergedMeta: ImportMeta = {
      ...meta,
      parsed: existing.length + fresh.length,
      totalRows: meta.totalRows,
    };
    await db.saveImportMeta(mergedMeta);
    const final = await finalize(raw, rates);
    set({
      transactions: final,
      transactionsRaw: raw,
      rates,
      importMeta: mergedMeta,
    });
    return { added: fresh.length, duplicates: incoming.length - fresh.length };
  },

  clearAll: async () => {
    await db.clearTransactions();
    await useDeletedStore.getState().clearAll();
    await useDeletedPayloadsStore.getState().clearAll();
    set({ transactions: [], transactionsRaw: [], importMeta: null });
  },

  setRate: async (currency, value) => {
    const rates: CurrencyRates = {
      ...get().rates,
      rates: { ...get().rates.rates, [currency]: value },
    };
    await db.saveRates(rates);
    const rules = await loadRules();
    const manualAliases = await loadManualAliasesFromStore();
    let raw = recalcBase(get().transactionsRaw, rates);
    raw = applyPayeeGrouping(raw, get().payeeGroupingEnabled, manualAliases);
    raw = applyCategoryRules(raw, rules);
    await db.saveTransactions(raw);
    const final = await finalize(raw, rates);
    set({ rates, transactions: final, transactionsRaw: raw });
  },

  setBase: async (newBase) => {
    const current = get().rates;
    if (newBase === current.base) return;
    const anchor = current.rates[newBase];
    if (!anchor || anchor <= 0) {
      throw new Error(
        `Установите положительный курс для ${newBase} перед сменой базовой валюты`
      );
    }
    // Rates were stored as "1 X = r[X] OLD_BASE".
    // After switching base to N, "1 X = r[X] / r[N] N".
    // Round to 6 decimals to keep the UI inputs readable.
    const round = (n: number) => Math.round(n * 1e6) / 1e6;
    const nextRates: Record<string, number> = {};
    for (const [cur, val] of Object.entries(current.rates)) {
      nextRates[cur] = cur === newBase ? 1 : round(val / anchor);
    }
    const rates: CurrencyRates = { base: newBase, rates: nextRates };
    await db.saveRates(rates);
    const rules = await loadRules();
    const manualAliases = await loadManualAliasesFromStore();
    let raw = recalcBase(get().transactionsRaw, rates);
    raw = applyPayeeGrouping(raw, get().payeeGroupingEnabled, manualAliases);
    raw = applyCategoryRules(raw, rules);
    await db.saveTransactions(raw);
    const final = await finalize(raw, rates);
    set({ rates, transactions: final, transactionsRaw: raw });
  },

  setPayeeGrouping: async (enabled) => {
    await db.saveJSON("payeeGrouping", enabled);
    const { transactionsRaw: existing, rates } = get();
    const rules = await loadRules();
    const manualAliases = await loadManualAliasesFromStore();
    let raw = recalcBase(existing, rates);
    raw = applyPayeeGrouping(raw, enabled, manualAliases);
    raw = applyCategoryRules(raw, rules);
    await db.saveTransactions(raw);
    const final = await finalize(raw, rates);
    set({ payeeGroupingEnabled: enabled, transactions: final, transactionsRaw: raw });
  },

  reapplyRules: async () => {
    const { transactionsRaw: existing, rates, payeeGroupingEnabled } = get();
    const rules = await loadRules();
    const manualAliases = await loadManualAliasesFromStore();
    let raw = recalcBase(existing, rates);
    raw = applyPayeeGrouping(raw, payeeGroupingEnabled, manualAliases);
    raw = applyCategoryRules(raw, rules);
    await db.saveTransactions(raw);
    const final = await finalize(raw, rates);
    set({ transactions: final, transactionsRaw: raw });
  },

  deleteTransaction: async (id) => {
    await snapshotForCloudRestore([id]);
    await useDeletedStore.getState().remove(id);
    // Recompute visible list from the unchanged raw set — the row is
    // still in `transactionsRaw` (and IDB) so a restore brings it back.
    const { transactionsRaw: raw, rates } = get();
    const final = await finalize(raw, rates);
    set({ transactions: final });
  },

  deleteTransactionMany: async (ids) => {
    if (ids.length === 0) return;
    await snapshotForCloudRestore(ids);
    await useDeletedStore.getState().removeMany(ids);
    const { transactionsRaw: raw, rates } = get();
    const final = await finalize(raw, rates);
    set({ transactions: final });
  },

  restoreTransaction: async (id) => {
    await useDeletedStore.getState().restore(id);
    const { transactionsRaw: raw, rates } = get();
    const final = await finalize(raw, rates);
    set({ transactions: final });
    void pushAfterRestore();
  },

  restoreTransactionMany: async (ids) => {
    if (ids.length === 0) return;
    await useDeletedStore.getState().restoreMany(ids);
    const { transactionsRaw: raw, rates } = get();
    const final = await finalize(raw, rates);
    set({ transactions: final });
    void pushAfterRestore();
  },
}));
