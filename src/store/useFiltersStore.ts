import { create } from "zustand";
import type { Transaction } from "../types";

export type DatePreset = "all" | "ytd" | "12m" | "6m" | "3m" | "30d" | "month" | "custom";

interface FiltersState {
  preset: DatePreset;
  from: string | null;
  to: string | null;
  monthYM: string | null;
  accounts: Set<string>;
  categories: Set<string>;
  currencies: Set<string>;
  search: string;
  excludeTransfers: boolean;

  setPreset: (p: DatePreset) => void;
  setRange: (from: string | null, to: string | null) => void;
  setMonth: (ym: string) => void;
  stepMonth: (delta: number, fallbackMaxYM: string) => void;
  toggleSet: (kind: "accounts" | "categories" | "currencies", value: string) => void;
  resetSet: (kind: "accounts" | "categories" | "currencies") => void;
  setSearch: (s: string) => void;
  setExcludeTransfers: (v: boolean) => void;
  reset: () => void;
}

const initial = {
  preset: "12m" as DatePreset,
  from: null,
  to: null,
  monthYM: null as string | null,
  accounts: new Set<string>(),
  categories: new Set<string>(),
  currencies: new Set<string>(),
  search: "",
  excludeTransfers: true,
};

function shiftYM(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const useFiltersStore = create<FiltersState>((set, get) => ({
  ...initial,
  setPreset: (preset) => set({ preset }),
  setRange: (from, to) => set({ from, to, preset: "custom" }),
  setMonth: (monthYM) => set({ preset: "month", monthYM }),
  stepMonth: (delta, fallbackMaxYM) => {
    const { preset, monthYM } = get();
    const cur = preset === "month" && monthYM ? monthYM : fallbackMaxYM;
    set({ preset: "month", monthYM: shiftYM(cur, delta) });
  },
  toggleSet: (kind, value) =>
    set((s) => {
      const next = new Set(s[kind]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { [kind]: next } as Pick<FiltersState, typeof kind>;
    }),
  resetSet: (kind) =>
    set(() => ({ [kind]: new Set<string>() }) as Pick<FiltersState, typeof kind>),
  setSearch: (search) => set({ search }),
  setExcludeTransfers: (excludeTransfers) => set({ excludeTransfers }),
  reset: () => set(initial),
}));

function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: fmt(first), to: fmt(last) };
}

export function presetToRange(
  preset: DatePreset,
  maxDate: string | null,
  monthYM?: string | null
): { from: string | null; to: string | null } {
  if (preset === "all" || preset === "custom") return { from: null, to: null };
  if (preset === "month") {
    if (!monthYM) return { from: null, to: null };
    return monthRange(monthYM);
  }
  const today = maxDate ? new Date(maxDate) : new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today);
  if (preset === "ytd") {
    from.setMonth(0, 1);
  } else if (preset === "12m") {
    from.setFullYear(from.getFullYear() - 1);
  } else if (preset === "6m") {
    from.setMonth(from.getMonth() - 6);
  } else if (preset === "3m") {
    from.setMonth(from.getMonth() - 3);
  } else if (preset === "30d") {
    from.setDate(from.getDate() - 30);
  }
  return { from: from.toISOString().slice(0, 10), to };
}

export function applyFilters(
  txs: Transaction[],
  state: FiltersState
): Transaction[] {
  const maxDate = txs.reduce((m, t) => (t.date > m ? t.date : m), "");
  const range =
    state.preset === "custom"
      ? { from: state.from, to: state.to }
      : presetToRange(state.preset, maxDate, state.monthYM);
  const search = state.search.trim().toLowerCase();
  return txs.filter((t) => {
    if (state.excludeTransfers && t.kind === "transfer") return false;
    if (range.from && t.date < range.from) return false;
    if (range.to && t.date > range.to) return false;
    if (state.accounts.size && !state.accounts.has(t.account)) return false;
    if (state.categories.size && !state.categories.has(t.category)) return false;
    if (state.currencies.size && !state.currencies.has(t.currency)) return false;
    if (search) {
      const hay = `${t.payee} ${t.comment} ${t.categoryFull}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}
