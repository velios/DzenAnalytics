import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, MousePointerClick } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useDrillStore } from "../store/useDrillStore";
import { dailyExpenseMap, type DayCell } from "../lib/aggregations";
import { formatMoney, formatDate, formatNum, ymdKey } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const EXPENSE_PALETTE = [
  "rgb(var(--c-panel2))",
  "rgba(239, 68, 68, 0.10)",
  "rgba(239, 68, 68, 0.20)",
  "rgba(239, 68, 68, 0.32)",
  "rgba(239, 68, 68, 0.46)",
  "rgba(239, 68, 68, 0.60)",
  "rgba(239, 68, 68, 0.74)",
  "rgba(239, 68, 68, 0.88)",
  "rgba(220, 38, 38, 1)",
];

const INCOME_PALETTE = [
  "rgb(var(--c-panel2))",
  "rgba(16, 185, 129, 0.10)",
  "rgba(16, 185, 129, 0.20)",
  "rgba(16, 185, 129, 0.32)",
  "rgba(16, 185, 129, 0.46)",
  "rgba(16, 185, 129, 0.60)",
  "rgba(16, 185, 129, 0.74)",
  "rgba(16, 185, 129, 0.88)",
  "rgba(5, 150, 105, 1)",
];

function buildThresholds(values: number[], n = 8): number[] {
  const positives = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (positives.length === 0) return [];
  const out: number[] = [];
  for (let i = 1; i <= n - 1; i++) {
    const idx = Math.floor((i / n) * positives.length);
    out.push(positives[Math.min(idx, positives.length - 1)]);
  }
  return out;
}

function binIdx(v: number, thresholds: number[], paletteSize: number): number {
  if (v <= 0) return 0;
  if (thresholds.length === 0) return paletteSize - 1;
  for (let i = 0; i < thresholds.length; i++) {
    if (v <= thresholds[i]) return i + 1;
  }
  return paletteSize - 1;
}

export function CalendarPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();
  const showDrill = useDrillStore((s) => s.show);

  const [kind, setKind] = useState<"expense" | "income">("expense");

  const filtered = useMemo(() => applyFilters(transactions, filters), [transactions, filters]);
  const dayMap = useMemo(() => dailyExpenseMap(filtered), [filtered]);

  const dates = useMemo(() => {
    const ds = filtered.map((t) => t.date).filter(Boolean).sort();
    return { min: ds[0] || "", max: ds[ds.length - 1] || "" };
  }, [filtered]);

  const initialYear = dates.max ? Number(dates.max.slice(0, 4)) : new Date().getFullYear();
  const [year, setYear] = useState(initialYear);

  const yearMin = dates.min ? Number(dates.min.slice(0, 4)) : initialYear;
  const yearMax = dates.max ? Number(dates.max.slice(0, 4)) : initialYear;

  const yearStats = useMemo(() => {
    let total = 0;
    let totalInc = 0;
    let count = 0;
    let max = 0;
    let activeDays = 0;
    const values: number[] = [];
    for (const [d, c] of dayMap) {
      if (d.startsWith(String(year))) {
        total += c.expense;
        totalInc += c.income;
        count += c.count;
        const v = kind === "expense" ? c.expense : c.income;
        if (v > max) max = v;
        if (v > 0) values.push(v);
        if (c.count > 0) activeDays++;
      }
    }
    const thresholds = buildThresholds(values, 8);
    return { total, totalInc, count, max, activeDays, thresholds };
  }, [dayMap, year, kind]);

  function openDay(date: string) {
    const txs = filtered.filter((t) => t.date === date);
    showDrill(formatDate(date), txs, "Операции за день");
  }

  if (transactions.length === 0) return <EmptyState />;

  const palette = kind === "expense" ? EXPENSE_PALETTE : INCOME_PALETTE;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CalendarDays}
        title="Календарь"
        hint={`Тепловая карта по дням. Цвет — интенсивность ${kind === "expense" ? "расходов" : "доходов"}. Клик по дню — операции.`}
        right={
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex bg-panel2 rounded-lg p-1 border border-border">
              <button
                onClick={() => setKind("expense")}
                className={`px-3 py-1 text-xs rounded-md ${kind === "expense" ? "bg-expense text-white" : "text-muted"}`}
              >
                Расходы
              </button>
              <button
                onClick={() => setKind("income")}
                className={`px-3 py-1 text-xs rounded-md ${kind === "income" ? "bg-income text-white" : "text-muted"}`}
              >
                Доходы
              </button>
            </div>
            <div className="flex items-center gap-1 bg-panel2 rounded-lg p-1 border border-border">
              <button
                onClick={() => setYear((y) => Math.max(yearMin, y - 1))}
                disabled={year <= yearMin}
                className="p-1 hover:text-accent disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 text-sm font-medium tabular-nums">{year}</span>
              <button
                onClick={() => setYear((y) => Math.min(yearMax, y + 1))}
                disabled={year >= yearMax}
                className="p-1 hover:text-accent disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <MousePointerClick className="w-3.5 h-3.5" />
              Кликабельный
            </span>
          </div>
        }
      />
      <GlobalFilters />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card card-pad">
          <div className="label mb-1">Расходы за {year}</div>
          <div className="stat-num text-expense">
            {formatMoney(yearStats.total, base, { compact: true })}
          </div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Доходы за {year}</div>
          <div className="stat-num text-income">
            {formatMoney(yearStats.totalInc, base, { compact: true })}
          </div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Операций</div>
          <div className="stat-num">{formatNum(yearStats.count)}</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Активных дней</div>
          <div className="stat-num">
            {yearStats.activeDays}<span className="text-muted text-sm ml-1">/ 365</span>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }, (_, m) => (
            <MonthGrid
              key={m}
              year={year}
              month={m}
              dayMap={dayMap}
              kind={kind}
              thresholds={yearStats.thresholds}
              palette={palette}
              onClick={openDay}
              base={base}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 mt-6 text-xs text-muted justify-end">
          <span>Меньше</span>
          {palette.map((c, i) => (
            <span
              key={i}
              className="w-3 h-3 rounded-sm border border-border/30"
              style={{ background: c }}
            />
          ))}
          <span>Больше</span>
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  year,
  month,
  dayMap,
  kind,
  thresholds,
  palette,
  onClick,
  base,
}: {
  year: number;
  month: number;
  dayMap: Map<string, DayCell>;
  kind: "expense" | "income";
  thresholds: number[];
  palette: string[];
  onClick: (date: string) => void;
  base: string;
}) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const firstWeekday = (firstDay.getDay() + 6) % 7;

  const cells: ({ d: number; date: string; cell?: DayCell } | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = ymdKey(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    cells.push({ d, date, cell: dayMap.get(date) });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  let monthTotal = 0;
  for (const c of cells) {
    if (c?.cell) monthTotal += kind === "expense" ? c.cell.expense : c.cell.income;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium text-sm">{MONTHS[month]}</div>
        <div className={`text-xs tabular-nums ${kind === "expense" ? "text-expense" : "text-income"}`}>
          {monthTotal > 0 ? formatMoney(monthTotal, base, { compact: true }) : ""}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-[10px] text-muted text-center">
            {w}
          </div>
        ))}
        {cells.map((c, i) => {
          if (!c) return <div key={i} className="aspect-square" />;
          const v = c.cell ? (kind === "expense" ? c.cell.expense : c.cell.income) : 0;
          const idx = binIdx(v, thresholds, palette.length);
          const bg = palette[idx];
          const isStrong = idx >= Math.ceil(palette.length * 0.55);
          const tooltip = c.cell
            ? `${formatDate(c.date)}: ${formatMoney(v, base, { compact: true })} · ${c.cell.count} оп.`
            : formatDate(c.date);
          return (
            <button
              key={i}
              onClick={() => c.cell && onClick(c.date)}
              disabled={!c.cell}
              title={tooltip}
              className="aspect-square rounded-sm border border-border/40 text-[10px] flex items-center justify-center transition-transform hover:scale-110 hover:border-accent disabled:hover:scale-100 disabled:hover:border-border/40 disabled:cursor-default"
              style={{ background: bg }}
            >
              <span className={isStrong ? "text-white font-medium" : v > 0 ? "text-text" : "text-muted"}>
                {c.d}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
