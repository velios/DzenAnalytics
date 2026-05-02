import { create } from "zustand";
import * as db from "../lib/db";

export interface Annotation {
  id: string;
  date: string;
  title: string;
  body?: string;
  color?: string;
}

interface AnnotationsState {
  annotations: Annotation[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  add: (a: Omit<Annotation, "id">) => Promise<void>;
  update: (id: string, patch: Partial<Annotation>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useAnnotationsStore = create<AnnotationsState>((set, get) => ({
  annotations: [],
  loaded: false,
  hydrate: async () => {
    const data = await db.loadJSON<Annotation[]>("annotations");
    set({ annotations: data || [], loaded: true });
  },
  add: async (a) => {
    const next: Annotation = {
      ...a,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
    const list = [...get().annotations, next].sort((x, y) =>
      x.date.localeCompare(y.date)
    );
    await db.saveJSON("annotations", list);
    set({ annotations: list });
  },
  update: async (id, patch) => {
    const list = get().annotations.map((a) => (a.id === id ? { ...a, ...patch } : a));
    await db.saveJSON("annotations", list);
    set({ annotations: list });
  },
  remove: async (id) => {
    const list = get().annotations.filter((a) => a.id !== id);
    await db.saveJSON("annotations", list);
    set({ annotations: list });
  },
}));
