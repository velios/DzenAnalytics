// Locally-deleted (hidden) transactions.
//
// Deleting a transaction in this app is a *soft* operation on the local
// side: we record the id in a persistent set and filter it out of every
// view (charts, tables, KPIs). The underlying record stays in
// `transactionsRaw` / IDB so a delete is reversible (restore) and so we
// still have the data needed to push a deletion to the cloud.
//
// Why a dedicated, monotonic set instead of just removing from the
// transactions array:
//   • API mode re-pulls the full state on every sync. A plain removal
//     would reappear on the next sync. A persistent id-set survives
//     re-mapping — the filter re-applies and the row stays hidden.
//   • When two-way sync (push) is on, the same set tells us which ids
//     still need a cloud-side deletion pushed.
//
// The set is never auto-pruned: even after a cloud deletion + resync
// (which yields a `deleted: true` tombstone the mapper already drops),
// keeping the id here is harmless and guarantees the row stays hidden
// in the gap between push and the next pull.

import { create } from "zustand";
import * as db from "../lib/db";

const KEY = "deletedTransactions";

interface DeletedState {
  /** Ids of transactions hidden locally. */
  deletedIds: string[];
  /** Fast membership lookups — kept in sync with `deletedIds`. */
  deletedSet: Set<string>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Hide a transaction. No-op if already hidden. */
  remove: (id: string) => Promise<void>;
  /** Un-hide a previously deleted transaction. */
  restore: (id: string) => Promise<void>;
  /** Un-hide many at once — one IDB write + one store update. */
  restoreMany: (ids: string[]) => Promise<void>;
  /** Drop the whole hidden set (used by "clear local data"). */
  clearAll: () => Promise<void>;
  isDeleted: (id: string) => boolean;
}

export const useDeletedStore = create<DeletedState>((set, get) => ({
  deletedIds: [],
  deletedSet: new Set(),
  loaded: false,

  hydrate: async () => {
    const stored = await db.loadJSON<string[]>(KEY);
    const ids = Array.isArray(stored) ? stored : [];
    set({ deletedIds: ids, deletedSet: new Set(ids), loaded: true });
  },

  remove: async (id) => {
    if (get().deletedSet.has(id)) return;
    const ids = [...get().deletedIds, id];
    set({ deletedIds: ids, deletedSet: new Set(ids) });
    await db.saveJSON(KEY, ids);
  },

  restore: async (id) => {
    if (!get().deletedSet.has(id)) return;
    const ids = get().deletedIds.filter((x) => x !== id);
    set({ deletedIds: ids, deletedSet: new Set(ids) });
    await db.saveJSON(KEY, ids);
  },

  restoreMany: async (toRestore) => {
    if (toRestore.length === 0) return;
    const drop = new Set(toRestore);
    const ids = get().deletedIds.filter((x) => !drop.has(x));
    if (ids.length === get().deletedIds.length) return;
    set({ deletedIds: ids, deletedSet: new Set(ids) });
    await db.saveJSON(KEY, ids);
  },

  clearAll: async () => {
    set({ deletedIds: [], deletedSet: new Set() });
    await db.saveJSON(KEY, []);
  },

  isDeleted: (id) => get().deletedSet.has(id),
}));

/** Read the hidden-id set without going through a hook — for the
 *  data-store pipeline and the push builder. Prefers the in-memory
 *  copy, falls back to disk before first hydrate. */
export async function loadDeletedSet(): Promise<Set<string>> {
  const s = useDeletedStore.getState();
  if (s.loaded) return s.deletedSet;
  const disk = await db.loadJSON<string[]>(KEY);
  return new Set(Array.isArray(disk) ? disk : []);
}
