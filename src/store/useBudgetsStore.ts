import { create } from "zustand";
import * as db from "../lib/db";
import { migrateLegacyBudgets, type BudgetLine } from "../lib/budgets";

const KEY = "budgetsV2";
const LEGACY_KEY = "budgets";

function thisMonth(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface BudgetsState {
  lines: BudgetLine[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  addLine: (line: Omit<BudgetLine, "id" | "createdAt">) => Promise<void>;
  updateLine: (id: string, patch: Partial<BudgetLine>) => Promise<void>;
  removeLine: (id: string) => Promise<void>;
  /** Set (or clear, when amount === null) a per-month override for a line. */
  setOverride: (id: string, ym: string, amount: number | null) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useBudgetsStore = create<BudgetsState>((set, get) => ({
  lines: [],
  loaded: false,

  hydrate: async () => {
    const stored = await db.loadJSON<BudgetLine[]>(KEY);
    if (stored) {
      set({ lines: stored, loaded: true });
      return;
    }
    // First run on the new model → migrate the legacy flat budgets, if any.
    const legacy = await db.loadJSON<Record<string, number>>(LEGACY_KEY);
    const migrated = migrateLegacyBudgets(legacy, thisMonth());
    if (migrated.length > 0) await db.saveJSON(KEY, migrated);
    set({ lines: migrated, loaded: true });
  },

  addLine: async (line) => {
    const next: BudgetLine = {
      ...line,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    };
    const list = [...get().lines, next];
    await db.saveJSON(KEY, list);
    set({ lines: list });
  },

  updateLine: async (id, patch) => {
    const list = get().lines.map((l) => (l.id === id ? { ...l, ...patch } : l));
    await db.saveJSON(KEY, list);
    set({ lines: list });
  },

  removeLine: async (id) => {
    const list = get().lines.filter((l) => l.id !== id);
    await db.saveJSON(KEY, list);
    set({ lines: list });
  },

  setOverride: async (id, ym, amount) => {
    const list = get().lines.map((l) => {
      if (l.id !== id) return l;
      const overrides = { ...(l.overrides ?? {}) };
      if (amount === null) delete overrides[ym];
      else overrides[ym] = amount;
      const hasAny = Object.keys(overrides).length > 0;
      return { ...l, overrides: hasAny ? overrides : undefined };
    });
    await db.saveJSON(KEY, list);
    set({ lines: list });
  },

  clearAll: async () => {
    await db.saveJSON(KEY, []);
    set({ lines: [] });
  },
}));
