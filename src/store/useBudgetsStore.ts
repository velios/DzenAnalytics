import { create } from "zustand";
import * as db from "../lib/db";

export interface Budget {
  category: string;
  amount: number;
}

interface BudgetsState {
  budgets: Record<string, number>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setBudget: (category: string, amount: number) => Promise<void>;
  removeBudget: (category: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useBudgetsStore = create<BudgetsState>((set, get) => ({
  budgets: {},
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<Record<string, number>>("budgets");
    set({ budgets: data || {}, loaded: true });
  },

  setBudget: async (category, amount) => {
    const next = { ...get().budgets, [category]: amount };
    await db.saveJSON("budgets", next);
    set({ budgets: next });
  },

  removeBudget: async (category) => {
    const next = { ...get().budgets };
    delete next[category];
    await db.saveJSON("budgets", next);
    set({ budgets: next });
  },

  clearAll: async () => {
    await db.saveJSON("budgets", {});
    set({ budgets: {} });
  },
}));
