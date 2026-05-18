// Per-category visual metadata pulled from Zenmoney's `tag` records.
// Persists as a single IDB blob and is refreshed on every successful sync.
//
// In CSV mode the map stays empty and UI falls back to default styling.

import { create } from "zustand";
import * as db from "../lib/db";
import type { CategoryMeta } from "../lib/zenmoneyMap";

interface State {
  meta: Record<string, CategoryMeta>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setAll: (m: Record<string, CategoryMeta>) => Promise<void>;
  clear: () => Promise<void>;
}

const KEY = "categoryMeta";

export const useCategoryMetaStore = create<State>((set) => ({
  meta: {},
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<Record<string, CategoryMeta>>(KEY);
    set({ meta: data || {}, loaded: true });
  },

  setAll: async (m) => {
    await db.saveJSON(KEY, m);
    set({ meta: m });
  },

  clear: async () => {
    await db.saveJSON(KEY, {});
    set({ meta: {} });
  },
}));
