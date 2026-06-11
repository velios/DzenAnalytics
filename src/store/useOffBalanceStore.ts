import { create } from "zustand";
import * as db from "../lib/db";

/**
 * Global "include off-balance accounts" setting.
 *
 * Zenmoney lets a user mark accounts as `inBalance:false` (savings, brokerage —
 * money they keep out of their day-to-day balance view). By default we mirror
 * that: such accounts are hidden from account lists and excluded from the
 * «Совокупный баланс» / net-worth figure. Turning this on makes them count
 * everywhere — both shown in the lists and included in the balance total.
 *
 * One global switch instead of per-page toggles, so behaviour is consistent
 * across Dashboard, Accounts, and the net-worth calculation.
 */
interface OffBalanceState {
  includeOffBalance: boolean;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setIncludeOffBalance: (value: boolean) => Promise<void>;
}

const KEY = "includeOffBalance";

export const useOffBalanceStore = create<OffBalanceState>((set) => ({
  includeOffBalance: false,
  loaded: false,
  hydrate: async () => {
    const data = await db.loadJSON<boolean>(KEY);
    set({ includeOffBalance: data === true, loaded: true });
  },
  setIncludeOffBalance: async (value) => {
    await db.saveJSON(KEY, value);
    set({ includeOffBalance: value });
  },
}));
