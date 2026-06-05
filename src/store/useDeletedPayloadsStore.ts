// Full Zenmoney payloads of locally-deleted transactions, kept so a
// restore can re-create them in the cloud.
//
// Why this exists: a cloud deletion is a tombstone, and our cache's
// `applyDiff` *removes* the ZenTransaction object on the deletion echo.
// After that we no longer hold the original payload, so a faithful
// "un-delete" would be impossible. We therefore snapshot the full
// ZenTransaction at delete time (API mode only). On the next push,
// `buildResurrections` re-sends snapshots whose id was restored
// (no longer hidden) and is no longer in the cloud — reviving the row
// with all its fields (merchant, tags, opIncome/opOutcome, …).

import { create } from "zustand";
import * as db from "../lib/db";
import type { ZenTransaction } from "../lib/zenmoney";

const KEY = "deletedPayloads";

interface DeletedPayloadsState {
  /** id → full Zenmoney transaction captured at delete time. */
  payloads: Record<string, ZenTransaction>;
  loaded: boolean;
  hydrate: () => Promise<void>;
  /** Snapshot many payloads (upsert by id). */
  saveMany: (txs: ZenTransaction[]) => Promise<void>;
  /** Drop snapshots once they're no longer needed (resurrected / pruned). */
  removeMany: (ids: string[]) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useDeletedPayloadsStore = create<DeletedPayloadsState>((set, get) => ({
  payloads: {},
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<Record<string, ZenTransaction>>(KEY);
    set({ payloads: data || {}, loaded: true });
  },

  saveMany: async (txs) => {
    if (txs.length === 0) return;
    const next = { ...get().payloads };
    for (const t of txs) next[t.id] = t;
    set({ payloads: next });
    await db.saveJSON(KEY, next);
  },

  removeMany: async (ids) => {
    if (ids.length === 0) return;
    const next = { ...get().payloads };
    let changed = false;
    for (const id of ids) {
      if (id in next) {
        delete next[id];
        changed = true;
      }
    }
    if (!changed) return;
    set({ payloads: next });
    await db.saveJSON(KEY, next);
  },

  clearAll: async () => {
    set({ payloads: {} });
    await db.saveJSON(KEY, {});
  },
}));

/** Read snapshots without a hook — for the push builder. Prefers the
 *  in-memory copy, falls back to disk before first hydrate. */
export async function loadDeletedPayloads(): Promise<
  Record<string, ZenTransaction>
> {
  const s = useDeletedPayloadsStore.getState();
  if (s.loaded) return s.payloads;
  const disk = await db.loadJSON<Record<string, ZenTransaction>>(KEY);
  return disk || {};
}
