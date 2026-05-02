import { create } from "zustand";
import * as db from "../lib/db";

export interface InflationConfig {
  enabled: boolean;
  baseYear: number;
  rates: Record<string, number>;
}

const DEFAULT: InflationConfig = {
  enabled: false,
  baseYear: new Date().getFullYear(),
  rates: {
    "2020": 4.9,
    "2021": 8.4,
    "2022": 11.9,
    "2023": 7.4,
    "2024": 9.5,
    "2025": 8.0,
    "2026": 6.0,
  },
};

interface InflationState {
  config: InflationConfig;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setEnabled: (v: boolean) => Promise<void>;
  setBaseYear: (y: number) => Promise<void>;
  setRate: (year: string, value: number) => Promise<void>;
}

export const useInflationStore = create<InflationState>((set, get) => ({
  config: DEFAULT,
  loaded: false,
  hydrate: async () => {
    const data = await db.loadJSON<InflationConfig>("inflation");
    set({ config: data || DEFAULT, loaded: true });
  },
  setEnabled: async (enabled) => {
    const config = { ...get().config, enabled };
    await db.saveJSON("inflation", config);
    set({ config });
  },
  setBaseYear: async (baseYear) => {
    const config = { ...get().config, baseYear };
    await db.saveJSON("inflation", config);
    set({ config });
  },
  setRate: async (year, value) => {
    const config = { ...get().config, rates: { ...get().config.rates, [year]: value } };
    await db.saveJSON("inflation", config);
    set({ config });
  },
}));

export function inflationFactor(date: string, config: InflationConfig): number {
  if (!config.enabled) return 1;
  const txYear = Number(date.slice(0, 4));
  if (!Number.isFinite(txYear)) return 1;
  if (txYear === config.baseYear) return 1;
  let factor = 1;
  if (txYear < config.baseYear) {
    for (let y = txYear; y < config.baseYear; y++) {
      const rate = config.rates[String(y)] || 0;
      factor *= 1 + rate / 100;
    }
  } else {
    for (let y = config.baseYear; y < txYear; y++) {
      const rate = config.rates[String(y)] || 0;
      factor /= 1 + rate / 100;
    }
  }
  return factor;
}
