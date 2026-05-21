import { create } from "zustand";
import * as db from "../lib/db";

/**
 * Manual payee aliases: explicit `from → to` mappings that the user
 * curates by hand. These ride ON TOP of the auto-grouping toggle:
 *
 *   1. Restore each tx's `payee` from `payeeOriginal`.
 *   2. If auto-grouping is enabled, apply the fuzzy alias map.
 *   3. Then apply the manual aliases — they always win, regardless of
 *      whether auto-grouping is on, so the user can pin down anything
 *      the fuzzy algorithm missed (or override it when it grouped too
 *      eagerly).
 *
 * Aliases are persisted to IndexedDB under key `payeeAliases`.
 */
export interface PayeeAlias {
  /** Source payee name as it appears in the data (case-sensitive). */
  from: string;
  /** Canonical payee name to use everywhere instead. */
  to: string;
}

interface PayeeAliasState {
  aliases: PayeeAlias[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  add: (from: string, to: string) => Promise<void>;
  remove: (from: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const usePayeeAliasStore = create<PayeeAliasState>((set, get) => ({
  aliases: [],
  loaded: false,
  hydrate: async () => {
    const data = await db.loadJSON<PayeeAlias[]>("payeeAliases");
    set({ aliases: Array.isArray(data) ? data : [], loaded: true });
  },
  add: async (from, to) => {
    const f = from.trim();
    const t = to.trim();
    if (!f || !t || f === t) return;
    const next = [
      ...get().aliases.filter((a) => a.from !== f),
      { from: f, to: t },
    ];
    await db.saveJSON("payeeAliases", next);
    set({ aliases: next });
  },
  remove: async (from) => {
    const next = get().aliases.filter((a) => a.from !== from);
    await db.saveJSON("payeeAliases", next);
    set({ aliases: next });
  },
  clearAll: async () => {
    await db.saveJSON("payeeAliases", []);
    set({ aliases: [] });
  },
}));

/** Convert the alias array to a lookup Map for the data-store pipeline. */
export function aliasesToMap(aliases: PayeeAlias[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of aliases) m.set(a.from, a.to);
  return m;
}
