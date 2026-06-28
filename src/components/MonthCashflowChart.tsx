import { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { Transaction } from "../types";
import { Tooltip } from "./Tooltip";
import { buildMonthCashflow } from "../lib/budgets";
import {
  formatMoney,
  formatNum,
  toNum,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
} from "../lib/format";

const INCOME = "#10B981";
const EXPENSE = "#EF4444";

/**
 * Full-width «денежный поток за месяц» widget — cumulative income (green) and
 * expense (red) across the days of `ym`, solid up to today and dashed as a
 * linear end-of-month forecast (mirrors Zenmoney «Планы» / «План на день»).
 * A readout below states the projected month-end gap: free money or shortfall.
 */
/** «сегодня» marker label, rendered INSIDE the plot area (just under the top,
 *  anchored left of the line) so it never clips at the chart edge. */
function TodayLabel({ viewBox }: { viewBox?: { x?: number; y?: number } }) {
  const x = viewBox?.x ?? 0;
  const y = viewBox?.y ?? 0;
  return (
    <text x={x - 6} y={y + 12} textAnchor="end" fontSize={10} fill={chartAxisStroke}>
      сегодня
    </text>
  );
}

export function MonthCashflowChart({
  transactions,
  ym,
  base,
  onDayClick,
}: {
  transactions: Transaction[];
  ym: string;
  base: string;
  /** Click a day on the chart → drill into that day's transactions. */
  onDayClick?: (day: number) => void;
}) {
  const cf = useMemo(() => buildMonthCashflow(transactions, ym), [transactions, ym]);
  const hasForecast = cf.todayDay > 0 && cf.todayDay < cf.days;

  // Projected month-end balance: > 0 → свободные деньги, < 0 → не хватает.
  const free = cf.projIncome - cf.projExpense;
  const tone = free >= 0 ? "income" : "expense";

  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
        <div className="flex gap-6">
          <div>
            <div className="label mb-0.5 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-income" /> Поступления
            </div>
            <div className="text-lg font-semibold tabular-nums text-income">
              {formatMoney(cf.factIncome, base)}
            </div>
            {hasForecast && (
              <div className="text-xs text-muted tabular-nums">
                прогноз {formatMoney(cf.projIncome, base)}
              </div>
            )}
          </div>
          <div>
            <div className="label mb-0.5 flex items-center gap-1.5">
              <TrendingDown className="w-3.5 h-3.5 text-expense" /> Расходы
            </div>
            <div className="text-lg font-semibold tabular-nums text-expense">
              {formatMoney(cf.factExpense, base)}
            </div>
            {hasForecast && (
              <div className="text-xs text-muted tabular-nums">
                прогноз {formatMoney(cf.projExpense, base)}
              </div>
            )}
          </div>
        </div>
        <Tooltip content={hasForecast ? "Прогноз на конец месяца по текущему темпу" : "Итог за месяц"}>
          <div
            className={`px-3 py-1.5 rounded-full text-sm font-medium tabular-nums whitespace-nowrap ${
              tone === "income" ? "bg-income/15 text-income" : "bg-expense/15 text-expense"
            }`}
          >
            {free >= 0 ? "Свободные деньги " : "Не хватает до конца месяца "}
            {formatMoney(Math.abs(free), base, { signed: false })}
          </div>
        </Tooltip>
      </div>

      <div
        className={`h-64 ${onDayClick ? "cursor-pointer" : ""}`}
        onClick={(e) => {
          // Day from the click X within the plot area (left margin 8 + YAxis 48).
          if (!onDayClick) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const left = 56;
          const right = 12;
          const plotW = rect.width - left - right;
          if (plotW <= 0) return;
          const frac = Math.min(Math.max((e.clientX - rect.left - left) / plotW, 0), 1);
          onDayClick(Math.round(1 + frac * (cf.days - 1)));
        }}
      >
        <ResponsiveContainer>
          <ComposedChart data={cf.points} margin={{ top: 18, right: 12, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
            <XAxis
              dataKey="day"
              stroke={chartAxisStroke}
              fontSize={11}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              stroke={chartAxisStroke}
              fontSize={11}
              tickLine={false}
              width={48}
              tickFormatter={(v) => formatNum(v, { compact: true })}
            />
            <ChartTooltip
              {...chartTooltipProps}
              labelFormatter={(d) => `День ${d}`}
              formatter={(v: unknown, name: unknown) => [formatMoney(toNum(v), base), String(name)]}
            />
            {hasForecast && (
              <ReferenceLine
                x={cf.todayDay}
                stroke={chartAxisStroke}
                strokeDasharray="2 2"
                label={<TodayLabel />}
              />
            )}
            {/* Actual cumulative — solid */}
            <Line type="monotone" dataKey="income" name="Поступления" stroke={INCOME} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="expense" name="Расходы" stroke={EXPENSE} strokeWidth={2} dot={false} isAnimationActive={false} />
            {/* Forecast — dashed continuation from today */}
            <Line type="monotone" dataKey="incomeF" name="Прогноз поступлений" stroke={INCOME} strokeWidth={2} strokeDasharray="4 3" strokeOpacity={0.7} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="expenseF" name="Прогноз расходов" stroke={EXPENSE} strokeWidth={2} strokeDasharray="4 3" strokeOpacity={0.7} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
