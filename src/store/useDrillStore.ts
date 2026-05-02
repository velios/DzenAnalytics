import { create } from "zustand";
import type { Transaction } from "../types";

interface DrillState {
  open: boolean;
  title: string;
  subtitle?: string;
  transactions: Transaction[];
  show: (title: string, txs: Transaction[], subtitle?: string) => void;
  close: () => void;
}

export const useDrillStore = create<DrillState>((set) => ({
  open: false,
  title: "",
  subtitle: undefined,
  transactions: [],
  show: (title, transactions, subtitle) =>
    set({ open: true, title, subtitle, transactions }),
  close: () => set({ open: false }),
}));
