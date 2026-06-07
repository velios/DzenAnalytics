// User display preferences (persisted). Currently just the "show kopecks"
// toggle, which controls how many fraction digits money is rendered with.
//
// The actual formatting lives in lib/format.ts as a module variable
// (`setMoneyFractionDigits`) so every formatMoney call follows it without
// threading the setting through props. This store mirrors it into React
// state so components re-render when it changes (App subscribes to it,
// cascading a re-render across the tree).

import { create } from "zustand";
import * as db from "../lib/db";
import { setMoneyFractionDigits } from "../lib/format";

const KEY = "displaySettings";

type FractionDigits = 0 | 2;

interface DisplayState {
  /** Fraction digits for money: 0 = whole amounts, 2 = kopecks/cents. */
  fractionDigits: FractionDigits;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setFractionDigits: (n: FractionDigits) => Promise<void>;
}

export const useDisplayStore = create<DisplayState>((set) => ({
  fractionDigits: 0,
  loaded: false,

  hydrate: async () => {
    const stored = await db.loadJSON<{ fractionDigits?: number }>(KEY);
    const fd: FractionDigits = stored?.fractionDigits === 2 ? 2 : 0;
    setMoneyFractionDigits(fd); // sync the formatter before first paint
    set({ fractionDigits: fd, loaded: true });
  },

  setFractionDigits: async (n) => {
    setMoneyFractionDigits(n); // update the formatter FIRST…
    set({ fractionDigits: n }); // …then trigger a re-render of subscribers
    await db.saveJSON(KEY, { fractionDigits: n });
  },
}));
