import { create } from "zustand";
import * as db from "../lib/db";

export interface Calibration {
  date: string;
  amount: number;
}

interface CalibrationState {
  calibration: Calibration | null;
  loaded: boolean;
  hydrate: () => Promise<void>;
  set: (c: Calibration) => Promise<void>;
  clear: () => Promise<void>;
}

export const useCalibrationStore = create<CalibrationState>((set) => ({
  calibration: null,
  loaded: false,

  hydrate: async () => {
    const data = await db.loadJSON<Calibration>("calibration");
    set({ calibration: data, loaded: true });
  },

  set: async (c) => {
    await db.saveJSON("calibration", c);
    set({ calibration: c });
  },

  clear: async () => {
    await db.saveJSON("calibration", null);
    set({ calibration: null });
  },
}));
