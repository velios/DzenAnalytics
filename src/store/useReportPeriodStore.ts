import { create } from "zustand";
import * as db from "../lib/db";

/**
 * "Отчётный период" — the day of the calendar month on which the user's
 * personal accounting month begins. Default 1 (calendar month). Values
 * are clamped to 1..28 in the UI (29–31 don't exist in every month).
 *
 * This store is consulted by:
 *   - useFiltersStore — "Месяц" preset range + month-step chevrons
 *   - DashboardPage — hero KPI "Доход / Расход" for "last period",
 *     Top-10 категорий за текущий период
 *   - CashflowPage — monthly bars / table / drill-down
 *   - groupByMonth in aggregations.ts (via opts)
 *
 * The setting is persisted to IndexedDB under key `reportPeriod`.
 */
interface ReportPeriodState {
  monthStartDay: number;
  loaded: boolean;
  hydrate: () => Promise<void>;
  setMonthStartDay: (day: number) => Promise<void>;
}

export const useReportPeriodStore = create<ReportPeriodState>((set) => ({
  monthStartDay: 1,
  loaded: false,
  hydrate: async () => {
    const data = await db.loadJSON<{ monthStartDay: number }>("reportPeriod");
    const day =
      data && typeof data.monthStartDay === "number"
        ? clamp(data.monthStartDay)
        : 1;
    set({ monthStartDay: day, loaded: true });
  },
  setMonthStartDay: async (day) => {
    const value = clamp(day);
    await db.saveJSON("reportPeriod", { monthStartDay: value });
    set({ monthStartDay: value });
  },
}));

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(28, Math.round(n)));
}
