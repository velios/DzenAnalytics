// Pending plan changes to push back to Zenmoney «Планы». Keyed by the budget
// edit id (kind, category, subcategory, month). Works like useTagEditsStore:
// the overlay is flushed to the cloud through the normal Push flow (so it obeys
// the Settings push mode), then cleared. Each entry carries the full edit so
// the push builder can resolve it without re-deriving from budget lines.

import { create } from "zustand";
import * as db from "../lib/db";
import { budgetEditId, type BudgetEdit } from "../lib/zenmoneyPush";

const KEY = "budgetEdits";

interface State {
  edits: Record<string, BudgetEdit>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Queue (or replace) a pending plan change for one (tag, month). */
  queue: (edit: BudgetEdit) => Promise<void>;
  clearMany: (ids: string[]) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useBudgetEditsStore = create<State>((set, get) => ({
  edits: {},
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<Record<string, BudgetEdit>>(KEY);
    set({ edits: data || {}, loaded: true });
  },

  queue: async (edit) => {
    const next = { ...get().edits, [budgetEditId(edit)]: edit };
    await db.saveJSON(KEY, next);
    set({ edits: next });
  },

  clearMany: async (ids) => {
    if (ids.length === 0) return;
    const next = { ...get().edits };
    let changed = false;
    for (const id of ids) {
      if (id in next) {
        delete next[id];
        changed = true;
      }
    }
    if (!changed) return;
    await db.saveJSON(KEY, next);
    set({ edits: next });
  },

  clearAll: async () => {
    await db.saveJSON(KEY, {});
    set({ edits: {} });
  },
}));

/** Read budget edits without a hook — for the push builder. */
export async function loadBudgetEdits(): Promise<Record<string, BudgetEdit>> {
  const s = useBudgetEditsStore.getState();
  if (s.loaded) return s.edits;
  const disk = await db.loadJSON<Record<string, BudgetEdit>>(KEY);
  return disk || {};
}
