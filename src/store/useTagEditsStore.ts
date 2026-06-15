// Pending edits to category tags (currently only the «обязательная»
// `required` flag). Keyed by Zenmoney tag id. Works like useEditsStore but for
// tags: the overlay survives a re-sync (re-applied onto categoryMeta) and is
// flushed to the cloud through the normal Push flow, then cleared.

import { create } from "zustand";
import * as db from "../lib/db";

export interface TagEdit {
  /** New value for the tag's `required` flag (true / false / null). */
  required: boolean | null;
}

const KEY = "tagEdits";

interface State {
  edits: Record<string, TagEdit>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setRequired: (tagId: string, required: boolean | null) => Promise<void>;
  clearMany: (ids: string[]) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useTagEditsStore = create<State>((set, get) => ({
  edits: {},
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<Record<string, TagEdit>>(KEY);
    set({ edits: data || {}, loaded: true });
  },

  setRequired: async (tagId, required) => {
    const next = { ...get().edits, [tagId]: { required } };
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

/** Read tag edits without a hook — for the push builder. */
export async function loadTagEdits(): Promise<Record<string, TagEdit>> {
  const s = useTagEditsStore.getState();
  if (s.loaded) return s.edits;
  const disk = await db.loadJSON<Record<string, TagEdit>>(KEY);
  return disk || {};
}
