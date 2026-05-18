import { create } from "zustand";
import type { Transaction, CurrencyRates, ImportMeta } from "../types";
import * as db from "../lib/db";
import { toBase } from "../lib/csv";
import { buildPayeeAliasMap } from "../lib/payeeNormalize";
import { applyCategoryRules, type CategoryRule } from "./useCategoryRulesStore";

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
  transactions: Transaction[];
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
}

function recalcBase(txs: Transaction[], rates: CurrencyRates): Transaction[] {
  return txs.map((t) => ({ ...t, amountBase: toBase(t.amount, t.currency, rates) }));
}

async function loadRules(): Promise<CategoryRule[]> {
  const data = await db.loadJSON<CategoryRule[]>("categoryRules");
  return data || [];
}

function applyPayeeGrouping(txs: Transaction[], enabled: boolean): Transaction[] {
  if (!enabled) {
    return txs.map((t) =>
      t.payeeOriginal && t.payee !== t.payeeOriginal
        ? { ...t, payee: t.payeeOriginal }
        : t
    );
  }
  const restored = txs.map((t) =>
    t.payeeOriginal ? { ...t, payee: t.payeeOriginal } : t
  );
  const allPayees = restored.map((t) => t.payee).filter(Boolean);
  const aliases = buildPayeeAliasMap(allPayees);
  if (aliases.size === 0) return restored;
  return restored.map((t) => {
    const canonical = aliases.get(t.payee);
    return canonical ? { ...t, payee: canonical } : t;
  });
}

export const useDataStore = create<DataState>((set, get) => ({
  transactions: [],
  rates: DEFAULT_RATES,
  importMeta: null,
  payeeGroupingEnabled: false,
  loaded: false,

  hydrate: async () => {
    const [txs, savedRates, meta, grouping, rules] = await Promise.all([
      db.loadTransactions(),
      db.loadRates(),
      db.loadImportMeta(),
      db.loadJSON<boolean>("payeeGrouping"),
      loadRules(),
    ]);
    const rates = mergeRatesWithDefaults(savedRates);
    let recalc = recalcBase(txs, rates);
    recalc = applyPayeeGrouping(recalc, grouping || false);
    recalc = applyCategoryRules(recalc, rules);
    set({
      transactions: recalc,
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
    let recalc = recalcBase(txs, rates);
    recalc = applyPayeeGrouping(recalc, payeeGroupingEnabled);
    recalc = applyCategoryRules(recalc, rules);
    await db.saveTransactions(recalc);
    await db.saveImportMeta(meta);
    set({ transactions: recalc, rates, importMeta: meta });
  },

  mergeTransactions: async (incoming, meta) => {
    const { payeeGroupingEnabled, transactions: existing } = get();
    const rates = ensureCurrenciesInRates(get().rates, incoming);
    if (rates !== get().rates) await db.saveRates(rates);
    const rules = await loadRules();
    const existingIds = new Set(existing.map((t) => t.id));
    const fresh = incoming.filter((t) => !existingIds.has(t.id));
    const combined = [...existing, ...fresh];
    let recalc = recalcBase(combined, rates);
    recalc = applyPayeeGrouping(recalc, payeeGroupingEnabled);
    recalc = applyCategoryRules(recalc, rules);
    await db.saveTransactions(recalc);
    const mergedMeta: ImportMeta = {
      ...meta,
      parsed: existing.length + fresh.length,
      totalRows: meta.totalRows,
    };
    await db.saveImportMeta(mergedMeta);
    set({ transactions: recalc, rates, importMeta: mergedMeta });
    return { added: fresh.length, duplicates: incoming.length - fresh.length };
  },

  clearAll: async () => {
    await db.clearTransactions();
    set({ transactions: [], importMeta: null });
  },

  setRate: async (currency, value) => {
    const rates: CurrencyRates = {
      ...get().rates,
      rates: { ...get().rates.rates, [currency]: value },
    };
    await db.saveRates(rates);
    const rules = await loadRules();
    let recalc = recalcBase(get().transactions, rates);
    recalc = applyPayeeGrouping(recalc, get().payeeGroupingEnabled);
    recalc = applyCategoryRules(recalc, rules);
    await db.saveTransactions(recalc);
    set({ rates, transactions: recalc });
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
    let recalc = recalcBase(get().transactions, rates);
    recalc = applyPayeeGrouping(recalc, get().payeeGroupingEnabled);
    recalc = applyCategoryRules(recalc, rules);
    await db.saveTransactions(recalc);
    set({ rates, transactions: recalc });
  },

  setPayeeGrouping: async (enabled) => {
    await db.saveJSON("payeeGrouping", enabled);
    const { transactions: existing, rates } = get();
    const rules = await loadRules();
    let recalc = recalcBase(existing, rates);
    recalc = applyPayeeGrouping(recalc, enabled);
    recalc = applyCategoryRules(recalc, rules);
    await db.saveTransactions(recalc);
    set({ payeeGroupingEnabled: enabled, transactions: recalc });
  },

  reapplyRules: async () => {
    const { transactions: existing, rates, payeeGroupingEnabled } = get();
    const rules = await loadRules();
    let recalc = recalcBase(existing, rates);
    recalc = applyPayeeGrouping(recalc, payeeGroupingEnabled);
    recalc = applyCategoryRules(recalc, rules);
    await db.saveTransactions(recalc);
    set({ transactions: recalc });
  },
}));
