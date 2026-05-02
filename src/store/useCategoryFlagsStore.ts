import { create } from "zustand";
import * as db from "../lib/db";

export type CategoryFlag = "fixed" | "discretionary";

interface FlagsState {
  flags: Record<string, CategoryFlag>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setFlag: (category: string, flag: CategoryFlag | null) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useCategoryFlagsStore = create<FlagsState>((set, get) => ({
  flags: {},
  loaded: false,
  hydrate: async () => {
    const data = await db.loadJSON<Record<string, CategoryFlag>>("categoryFlags");
    set({ flags: data || {}, loaded: true });
  },
  setFlag: async (category, flag) => {
    const next = { ...get().flags };
    if (flag === null) delete next[category];
    else next[category] = flag;
    await db.saveJSON("categoryFlags", next);
    set({ flags: next });
  },
  clearAll: async () => {
    await db.saveJSON("categoryFlags", {});
    set({ flags: {} });
  },
}));
