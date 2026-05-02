import { create } from "zustand";
import * as db from "../lib/db";

export interface Goal {
  id: string;
  name: string;
  target: number;
  current: number;
  deadline: string | null;
  createdAt: string;
}

interface GoalsState {
  goals: Goal[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  add: (g: Omit<Goal, "id" | "createdAt">) => Promise<void>;
  update: (id: string, patch: Partial<Goal>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useGoalsStore = create<GoalsState>((set, get) => ({
  goals: [],
  loaded: false,
  hydrate: async () => {
    const data = await db.loadJSON<Goal[]>("goals");
    set({ goals: data || [], loaded: true });
  },
  add: async (g) => {
    const next: Goal = {
      ...g,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    };
    const list = [...get().goals, next];
    await db.saveJSON("goals", list);
    set({ goals: list });
  },
  update: async (id, patch) => {
    const list = get().goals.map((g) => (g.id === id ? { ...g, ...patch } : g));
    await db.saveJSON("goals", list);
    set({ goals: list });
  },
  remove: async (id) => {
    const list = get().goals.filter((g) => g.id !== id);
    await db.saveJSON("goals", list);
    set({ goals: list });
  },
}));
