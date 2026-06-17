// «Не дубликаты» — exceptions the user records on the Duplicates page.
//
// Keyed by the duplicate-group SIGNATURE (kind|payee|amount|currency, exactly
// what `detectDuplicates` builds), so a marked group is never flagged again —
// even after a re-sync that changes transaction ids. Persisted to IndexedDB
// and listed back on the page so the user can drop a rule later.

import { create } from "zustand";
import * as db from "../lib/db";
import type { TxKind } from "../types";

export interface DupExclusion {
  /** The group signature — the rule's key. */
  signature: string;
  // Human-readable bits for the rules list.
  payee: string;
  amount: number;
  currency: string;
  kind: TxKind;
  /** Full category path of the group's first transaction («Еда / Кафе»).
   *  Optional — rules saved before this field stay without it. */
  category?: string;
  createdAt: string;
}

const KEY = "duplicateExclusions";

interface State {
  rules: Record<string, DupExclusion>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  add: (rule: DupExclusion) => Promise<void>;
  remove: (signature: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useDuplicateExclusionsStore = create<State>((set, get) => ({
  rules: {},
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<Record<string, DupExclusion>>(KEY);
    set({ rules: data || {}, loaded: true });
  },

  add: async (rule) => {
    const next = { ...get().rules, [rule.signature]: rule };
    await db.saveJSON(KEY, next);
    set({ rules: next });
  },

  remove: async (signature) => {
    if (!(signature in get().rules)) return;
    const next = { ...get().rules };
    delete next[signature];
    await db.saveJSON(KEY, next);
    set({ rules: next });
  },

  clearAll: async () => {
    await db.saveJSON(KEY, {});
    set({ rules: {} });
  },
}));
