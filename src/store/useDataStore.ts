import { create } from "zustand";
import type { Transaction, CurrencyRates, ImportMeta } from "../types";
import * as db from "../lib/db";
import { toBase } from "../lib/csv";
import { buildPayeeAliasMap } from "../lib/payeeNormalize";
import { applyCategoryRules, type CategoryRule } from "./useCategoryRulesStore";

const DEFAULT_RATES: CurrencyRates = {
  base: "RUB",
  rates: { RUB: 1, USD: 90, CNY: 12.5, TRY: 2.4 },
};

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
    const rates = savedRates || DEFAULT_RATES;
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
    const { rates, payeeGroupingEnabled } = get();
    const rules = await loadRules();
    let recalc = recalcBase(txs, rates);
    recalc = applyPayeeGrouping(recalc, payeeGroupingEnabled);
    recalc = applyCategoryRules(recalc, rules);
    await db.saveTransactions(recalc);
    await db.saveImportMeta(meta);
    set({ transactions: recalc, importMeta: meta });
  },

  mergeTransactions: async (incoming, meta) => {
    const { rates, payeeGroupingEnabled, transactions: existing } = get();
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
    set({ transactions: recalc, importMeta: mergedMeta });
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
