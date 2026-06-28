import { create } from "zustand";
import * as db from "../lib/db";
import { migrateLegacyBudgets, type BudgetLine, type BudgetKind } from "../lib/budgets";

/** A Zenmoney plan row, ready to seed a budget line. */
export interface ZenPlanSeed {
  kind: BudgetKind;
  category: string;
  /** Sub-category title, or null when the plan is on the parent tag itself. */
  subcategory: string | null;
  ym: string; // "YYYY-MM"
  amount: number;
}

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
  /** Create budget lines from Zenmoney plans for any (kind, category) that
   *  doesn't have a line yet. Existing lines are left untouched (their plan
   *  stays the user's; per-line «взять» pulls Zen updates). Called after a
   *  full sync so budgets appear automatically. */
  importFromZen: (plans: ZenPlanSeed[]) => Promise<void>;
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

  importFromZen: async (plans) => {
    // Identity is per TAG: (kind, category, subcategory). NUL-joined so titles
    // with «:» don't collide.
    const idOf = (kind: string, category: string, sub: string | null) =>
      [kind, category, sub ?? ""].join("\u0000");
    const existing = new Set(
      get().lines.map((l) => idOf(l.kind, l.category, l.subcategory ?? null))
    );
    // Group plans by (kind, category, subcategory) → per-month amounts, skipping
    // tags the user already budgets (never overwrite or duplicate).
    const groups = new Map<
      string,
      {
        kind: BudgetKind;
        category: string;
        subcategory: string | null;
        months: Map<string, number>;
      }
    >();
    for (const p of plans) {
      if (!(p.amount > 0)) continue;
      const key = idOf(p.kind, p.category, p.subcategory);
      if (existing.has(key)) continue;
      let g = groups.get(key);
      if (!g) {
        g = { kind: p.kind, category: p.category, subcategory: p.subcategory, months: new Map() };
        groups.set(key, g);
      }
      g.months.set(p.ym, p.amount);
    }
    if (groups.size === 0) return;
    const additions: BudgetLine[] = [];
    for (const g of groups.values()) {
      const months = [...g.months.keys()].sort();
      // Zenmoney plans are PER-MONTH, not recurring: a month with no plan is 0,
      // NOT a carry-forward of an earlier value. So store every planned month as
      // an explicit override and keep the recurring base at 0 — months Zen
      // doesn't cover (e.g. a parent the user zeroed this month, budgeting only
      // its sub-tags) read as «нет плана», not a phantom carried-over amount.
      const overrides: Record<string, number> = {};
      for (const [m, amt] of g.months) overrides[m] = amt;
      additions.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        category: g.category,
        subcategory: g.subcategory,
        kind: g.kind,
        amount: 0,
        recurrence: "monthly",
        startMonth: months[0],
        endMonth: null,
        overrides,
        createdAt: new Date().toISOString(),
      });
    }
    const list = [...get().lines, ...additions];
    await db.saveJSON(KEY, list);
    set({ lines: list });
  },

  clearAll: async () => {
    await db.saveJSON(KEY, []);
    set({ lines: [] });
  },
}));
