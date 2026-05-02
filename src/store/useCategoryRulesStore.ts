import { create } from "zustand";
import * as db from "../lib/db";
import type { Transaction } from "../types";

export type RuleField = "payee" | "comment" | "category";
export type RuleOp = "contains" | "equals" | "starts_with" | "regex";

export interface CategoryRule {
  id: string;
  enabled: boolean;
  field: RuleField;
  op: RuleOp;
  value: string;
  caseInsensitive: boolean;
  category: string;
  createdAt: string;
}

interface RulesState {
  rules: CategoryRule[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  add: (r: Omit<CategoryRule, "id" | "createdAt">) => Promise<void>;
  update: (id: string, patch: Partial<CategoryRule>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  move: (id: string, dir: -1 | 1) => Promise<void>;
}

export const useCategoryRulesStore = create<RulesState>((set, get) => ({
  rules: [],
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<CategoryRule[]>("categoryRules");
    set({ rules: data || [], loaded: true });
  },

  add: async (r) => {
    const next: CategoryRule = {
      ...r,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    };
    const list = [...get().rules, next];
    await db.saveJSON("categoryRules", list);
    set({ rules: list });
  },

  update: async (id, patch) => {
    const list = get().rules.map((r) => (r.id === id ? { ...r, ...patch } : r));
    await db.saveJSON("categoryRules", list);
    set({ rules: list });
  },

  remove: async (id) => {
    const list = get().rules.filter((r) => r.id !== id);
    await db.saveJSON("categoryRules", list);
    set({ rules: list });
  },

  move: async (id, dir) => {
    const list = [...get().rules];
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    await db.saveJSON("categoryRules", list);
    set({ rules: list });
  },
}));

function matchRule(t: Transaction, r: CategoryRule): boolean {
  if (!r.enabled) return false;
  let haystack = "";
  switch (r.field) {
    case "payee": haystack = t.payeeOriginal || t.payee || ""; break;
    case "comment": haystack = t.comment || ""; break;
    case "category": haystack = t.categoryFullOriginal || t.categoryFull || ""; break;
  }
  let needle = r.value;
  if (r.caseInsensitive) {
    haystack = haystack.toLowerCase();
    needle = needle.toLowerCase();
  }
  switch (r.op) {
    case "contains": return haystack.includes(needle);
    case "equals": return haystack === needle;
    case "starts_with": return haystack.startsWith(needle);
    case "regex": {
      try {
        return new RegExp(r.value, r.caseInsensitive ? "iu" : "u").test(
          r.field === "payee" ? t.payeeOriginal || t.payee || ""
            : r.field === "comment" ? t.comment || ""
              : t.categoryFullOriginal || t.categoryFull || ""
        );
      } catch {
        return false;
      }
    }
  }
}

function splitCategoryFull(full: string): { category: string; subcategory: string | null } {
  if (!full) return { category: "Без категории", subcategory: null };
  const parts = full.split(/\s*\/\s*/);
  return {
    category: parts[0],
    subcategory: parts.slice(1).join(" / ") || null,
  };
}

export function applyCategoryRules(
  txs: Transaction[],
  rules: CategoryRule[]
): Transaction[] {
  const enabledRules = rules.filter((r) => r.enabled);

  return txs.map((t) => {
    const origFull = t.categoryFullOriginal ?? t.categoryFull;
    const origCategory = t.categoryOriginal ?? t.category;
    const origSubcategory = t.subcategoryOriginal !== undefined ? t.subcategoryOriginal : t.subcategory;

    if (enabledRules.length === 0) {
      return {
        ...t,
        category: origCategory,
        subcategory: origSubcategory,
        categoryFull: origFull,
      };
    }

    const restored = {
      ...t,
      category: origCategory,
      subcategory: origSubcategory,
      categoryFull: origFull,
    };

    for (const rule of enabledRules) {
      if (matchRule(restored, rule)) {
        const split = splitCategoryFull(rule.category);
        return {
          ...restored,
          category: split.category,
          subcategory: split.subcategory,
          categoryFull: rule.category,
        };
      }
    }
    return restored;
  });
}
