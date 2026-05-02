import { create } from "zustand";
import * as db from "../lib/db";
import type { DatePreset } from "./useFiltersStore";

export interface SavedView {
  id: string;
  name: string;
  preset: DatePreset;
  from: string | null;
  to: string | null;
  monthYM?: string | null;
  accounts: string[];
  categories: string[];
  currencies: string[];
  search: string;
  excludeTransfers: boolean;
  createdAt: string;
}

interface SavedViewsState {
  views: SavedView[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  add: (view: Omit<SavedView, "id" | "createdAt">) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
}

export const useSavedViewsStore = create<SavedViewsState>((set, get) => ({
  views: [],
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<SavedView[]>("savedViews");
    set({ views: data || [], loaded: true });
  },

  add: async (view) => {
    const next: SavedView = {
      ...view,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    };
    const list = [...get().views, next];
    await db.saveJSON("savedViews", list);
    set({ views: list });
  },

  remove: async (id) => {
    const list = get().views.filter((v) => v.id !== id);
    await db.saveJSON("savedViews", list);
    set({ views: list });
  },

  rename: async (id, name) => {
    const list = get().views.map((v) => (v.id === id ? { ...v, name } : v));
    await db.saveJSON("savedViews", list);
    set({ views: list });
  },
}));
