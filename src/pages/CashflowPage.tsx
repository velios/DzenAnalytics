import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
  Area,
  AreaChart,
  Cell,
} from "recharts";
import {
  TrendingDown,
  TrendingUp,
  Wallet,
  Hash,
  Calendar,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Layers,
  LineChart as LineChartIcon,
  Sparkles,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useDrillStore } from "../store/useDrillStore";
import { useAnnotationsStore } from "../store/useAnnotationsStore";
import {
  groupByMonth,
  computeKPI,
  buildInsights,
  buildScenarioForecast,
  yearOverYearMonthly,
  vsAverageStats,
  buildStreamData,
  detectSeasonality,
} from "../lib/aggregations";
import { InsightsPanel } from "../components/InsightsPanel";
import {
  formatMoney,
  monthLabel,
  formatNum,
  toNum,
  ymKey,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
} from "../lib/format";
import { Stat } from "../components/Stat";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { SortableTable } from "../components/SortableTable";
import type { MonthBucket } from "../lib/aggregations";

export function CashflowPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();

  const showDrill = useDrillStore((s) => s.show);

  const filtered = useMemo(() => applyFilters(transactions, filters), [transactions, filters]);
  const months = useMemo(() => groupByMonth(filtered), [filtered]);
  const kpi = useMemo(() => computeKPI(filtered), [filtered]);
  const insights = useMemo(() => buildInsights(filtered), [filtered]);
  const scenarios = useMemo(() => buildScenarioForecast(filtered, 6, 6), [filtered]);
  const vsAvg = useMemo(() => vsAverageStats(filtered), [filtered]);

  const annotations = useAnnotationsStore((s) => s.annotations);
  const annHydrate = useAnnotationsStore((s) => s.hydrate);
  const annLoaded = useAnnotationsStore((s) => s.loaded);
  useEffect(() => {
    if (!annLoaded) annHydrate();
  }, [annLoaded, annHydrate]);

  const allYears = useMemo(() => {
    const set = new Set<number>();
    for (const t of transactions) set.add(Number(t.date.slice(0, 4)));
    return Array.from(set).sort();
  }, [transactions]);
  const [yoyYear, setYoyYear] = useState(allYears[allYears.length - 1] || new Date().getFullYear());
  const [yoyKind, setYoyKind] = useState<"expense" | "income">("expense");
  useEffect(() => {
    if (allYears.length && !allYears.includes(yoyYear)) setYoyYear(allYears[allYears.length - 1]);
  }, [allYears, yoyYear]);
  const yoyData = useMemo(
    () => yearOverYearMonthly(transactions, yoyYear, yoyKind),
    [transactions, yoyYear, yoyKind]
  );

  // Cash-flow visualization mode: bars (по умолчанию) или stream graph
  const [vizMode, setVizMode] = useState<"bars" | "stream">("bars");
  const stream = useMemo(() => buildStreamData(filtered, 10, "expense"), [filtered]);

  // Seasonality
  const seasonality = useMemo(() => detectSeasonality(transactions), [transactions]);

  function openMonth(ym: string) {
    const txs = filtered.filter((t) => ymKey(t.date) === ym);
    showDrill(monthLabel(ym), txs, "Месяц");
  }
  function openAll() {
    showDrill("Все операции (с фильтрами)", filtered, "Период");
  }

  if (transactions.length === 0) return <EmptyState />;

  const chartData = scenarios.map((p) => ({
    ym: p.ym,
    month: monthLabel(p.ym),
    income: p.isForecast ? null : Math.round(p.income),
    expense: p.isForecast ? null : Math.round(p.expense),
    incomeF: p.isForecast ? Math.round(p.income) : null,
    expenseF: p.isForecast ? Math.round(p.expense) : null,
    net: p.isForecast ? null : Math.round(p.realistic),
    netForecastTop: p.isForecast ? Math.round(p.optimistic) : null,
    netForecastBottom: p.isForecast ? Math.round(p.pessimistic) : null,
    netForecastMid: p.isForecast ? Math.round(p.realistic) : null,
    isForecast: p.isForecast,
  }));

  const annotationsInRange = useMemo(() => {
    const set = new Set(chartData.map((d) => d.ym));
    return annotations.filter((a) => set.has(a.date.slice(0, 7)));
  }, [annotations, chartData]);

  const monthsCount = months.length || 1;
  const avgMonthlyExpense = kpi.expense / monthsCount;
  const avgMonthlyIncome = kpi.income / monthsCount;
  const savingsRate = kpi.income > 0 ? (kpi.income - kpi.expense) / kpi.income : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LineChartIcon}
        title="Cash-flow"
        hint="Доходы, расходы и чистый поток по месяцам."
      />
      <GlobalFilters />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat
          label="Доходы"
          value={formatMoney(kpi.income, base, { decimals: 0 })}
          tone="income"
          icon={<TrendingUp className="w-4 h-4" />}
          hint={`${formatNum(avgMonthlyIncome, { compact: true })} ${base} / мес`}
        />
        <Stat
          label="Расходы"
          value={formatMoney(kpi.expense, base, { decimals: 0 })}
          tone="expense"
          icon={<TrendingDown className="w-4 h-4" />}
          hint={`${formatNum(avgMonthlyExpense, { compact: true })} ${base} / мес`}
        />
        <Stat
          label="Чистый поток"
          value={formatMoney(kpi.net, base, { decimals: 0, signed: true })}
          tone={kpi.net >= 0 ? "income" : "expense"}
          icon={<Wallet className="w-4 h-4" />}
          hint={`Норма сбережений: ${(savingsRate * 100).toFixed(1)}%`}
        />
        <button onClick={openAll} className="text-left">
          <Stat
            label="Операций (клик)"
            value={formatNum(kpi.count)}
            icon={<Hash className="w-4 h-4" />}
            hint={
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {kpi.daysSpan} дн · {kpi.uniqueCategories} кат · {kpi.uniquePayees} получ.
              </span>
            }
          />
        </button>
      </div>

      <InsightsPanel insights={insights} base={base} />

      <div className="card card-pad">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="font-semibold">
              {vizMode === "bars" ? "Доходы и расходы по месяцам" : "Stream graph по категориям"}
            </div>
            <div className="text-xs text-muted">
              {vizMode === "bars"
                ? "Столбцы — суммы, линия — чистый поток"
                : "Категории как реки расходов во времени"}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-panel2 rounded-lg p-1 border border-border">
              <button
                onClick={() => setVizMode("bars")}
                className={`px-3 py-1 text-xs rounded-md flex items-center gap-1 ${vizMode === "bars" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                <BarChart3 className="w-3 h-3" />
                Бары
              </button>
              <button
                onClick={() => setVizMode("stream")}
                className={`px-3 py-1 text-xs rounded-md flex items-center gap-1 ${vizMode === "stream" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                <Layers className="w-3 h-3" />
                Stream
              </button>
            </div>
            <div className="text-xs text-muted">{months.length} мес.</div>
          </div>
        </div>
        <div className="h-80">
          {vizMode === "bars" ? (
          <ResponsiveContainer>
            <ComposedChart
              data={chartData}
              onClick={(e: unknown) => {
                const ev = e as { activePayload?: { payload?: { ym?: string } }[] } | undefined;
                const ym = ev?.activePayload?.[0]?.payload?.ym;
                if (ym) openMonth(ym);
              }}
              style={{ cursor: "pointer" }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
              <XAxis dataKey="month" stroke={chartAxisStroke} fontSize={11} />
              <YAxis
                stroke={chartAxisStroke}
                fontSize={11}
                tickFormatter={(v) => formatNum(v, { compact: true })}
              />
              <Tooltip
                {...chartTooltipProps}
                formatter={(v: unknown) => formatMoney(toNum(v), base, { compact: true })}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="income" name="Доходы" fill="#10B981" radius={[4, 4, 0, 0]} activeBar={false} />
              <Bar dataKey="expense" name="Расходы" fill="#EF4444" radius={[4, 4, 0, 0]} activeBar={false} />
              <Bar dataKey="incomeF" name="Прогноз дох." fill="#10B981" fillOpacity={0.35} stroke="#10B981" strokeDasharray="3 3" radius={[4, 4, 0, 0]} activeBar={false} />
              <Bar dataKey="expenseF" name="Прогноз расх." fill="#EF4444" fillOpacity={0.35} stroke="#EF4444" strokeDasharray="3 3" radius={[4, 4, 0, 0]} activeBar={false} />
              <Line
                type="monotone"
                dataKey="net"
                name="Чистый поток"
                stroke="#22D3EE"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Area
                type="monotone"
                dataKey="netForecastTop"
                name="Прогноз: оптимист"
                stroke="#22D3EE"
                fill="#22D3EE"
                fillOpacity={0.08}
                strokeDasharray="4 3"
                strokeOpacity={0.5}
              />
              <Area
                type="monotone"
                dataKey="netForecastBottom"
                name="Прогноз: пессимист"
                stroke="#A78BFA"
                fill="#A78BFA"
                fillOpacity={0.08}
                strokeDasharray="4 3"
                strokeOpacity={0.5}
              />
              <Line
                type="monotone"
                dataKey="netForecastMid"
                name="Прогноз: реалист"
                stroke="#22D3EE"
                strokeWidth={2}
                strokeDasharray="3 3"
                dot={false}
              />
              {annotationsInRange.map((a) => (
                <ReferenceLine
                  key={a.id}
                  x={monthLabel(a.date.slice(0, 7))}
                  stroke={a.color || "#A78BFA"}
                  strokeDasharray="2 2"
                  label={{ value: a.title, position: "top", fontSize: 10, fill: a.color || "#A78BFA" }}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
          ) : (
            <ResponsiveContainer>
              <AreaChart
                data={stream.data}
                stackOffset="silhouette"
                onClick={(e: unknown) => {
                  const ev = e as { activePayload?: { payload?: { ym?: string } }[] } | undefined;
                  const ym = ev?.activePayload?.[0]?.payload?.ym;
                  if (ym) openMonth(ym);
                }}
                style={{ cursor: "pointer" }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis
                  dataKey="label"
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(d) => monthLabel(String(d))}
                  minTickGap={40}
                />
                <YAxis hide />
                <Tooltip
                  {...chartTooltipProps}
                  labelFormatter={(d) => monthLabel(String(d))}
                  formatter={(v: unknown, n: unknown) => [
                    formatMoney(toNum(v), base, { compact: true }),
                    String(n),
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {stream.categories.map((cat, i) => {
                  const colors = [
                    "#22D3EE", "#A78BFA", "#F59E0B", "#10B981", "#EF4444",
                    "#EC4899", "#3B82F6", "#84CC16", "#F97316", "#14B8A6", "#6B7280",
                  ];
                  return (
                    <Area
                      key={cat}
                      type="monotone"
                      dataKey={cat}
                      stackId="stream"
                      stroke={colors[i % colors.length]}
                      fill={colors[i % colors.length]}
                      fillOpacity={0.75}
                    />
                  );
                })}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
        {vsAvg.current && vsAvg.avg.expense > 0 && (
          <div className="text-xs mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-muted">
            <div>
              Расходы текущего месяца:{" "}
              <span
                className={
                  vsAvg.current.expense > vsAvg.avg.expense * 1.1
                    ? "text-expense"
                    : vsAvg.current.expense < vsAvg.avg.expense * 0.9
                      ? "text-income"
                      : "text-text"
                }
              >
                {((vsAvg.current.expense / vsAvg.avg.expense - 1) * 100).toFixed(0)}%
              </span>{" "}
              от среднего
            </div>
            <div>
              Доходы текущего месяца:{" "}
              <span className="text-text">
                {vsAvg.avg.income > 0
                  ? `${((vsAvg.current.income / vsAvg.avg.income - 1) * 100).toFixed(0)}%`
                  : "—"}
              </span>{" "}
              от среднего
            </div>
            <div>
              Чистый: <span className={vsAvg.current.net > vsAvg.avg.net ? "text-income" : "text-expense"}>
                {vsAvg.current.net > vsAvg.avg.net ? "лучше" : "хуже"}
              </span>{" "}
              среднего на {formatMoney(Math.abs(vsAvg.current.net - vsAvg.avg.net), base, { compact: true })}
            </div>
          </div>
        )}
      </div>

      {allYears.length >= 2 && (
        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
            <div>
              <div className="font-semibold">Год к году</div>
              <div className="text-xs text-muted">
                Сравнение с тем же месяцем годом ранее
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex bg-panel2 rounded-lg p-1 border border-border">
                <button
                  onClick={() => setYoyKind("expense")}
                  className={`px-3 py-1 text-xs rounded-md ${yoyKind === "expense" ? "bg-expense text-white" : "text-muted"}`}
                >
                  Расходы
                </button>
                <button
                  onClick={() => setYoyKind("income")}
                  className={`px-3 py-1 text-xs rounded-md ${yoyKind === "income" ? "bg-income text-white" : "text-muted"}`}
                >
                  Доходы
                </button>
              </div>
              <div className="flex items-center gap-1 bg-panel2 rounded-lg p-1 border border-border">
                <button
                  onClick={() =>
                    setYoyYear((y) => {
                      const idx = allYears.indexOf(y);
                      return idx > 0 ? allYears[idx - 1] : y;
                    })
                  }
                  disabled={allYears.indexOf(yoyYear) <= 0}
                  className="p-1 hover:text-accent disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-3 text-sm font-medium tabular-nums">{yoyYear}</span>
                <button
                  onClick={() =>
                    setYoyYear((y) => {
                      const idx = allYears.indexOf(y);
                      return idx < allYears.length - 1 ? allYears[idx + 1] : y;
                    })
                  }
                  disabled={allYears.indexOf(yoyYear) >= allYears.length - 1}
                  className="p-1 hover:text-accent disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer>
              <ComposedChart data={yoyData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis dataKey="monthName" stroke={chartAxisStroke} fontSize={11} />
                <YAxis
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(v) => formatNum(v, { compact: true })}
                />
                <Tooltip
                  {...chartTooltipProps}
                  formatter={(v: unknown) => formatMoney(toNum(v), base, { compact: true })}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="lastYear"
                  name={`${yoyYear - 1}`}
                  fill="#A78BFA"
                  radius={[4, 4, 0, 0]}
                  activeBar={false}
                />
                <Bar
                  dataKey="thisYear"
                  name={`${yoyYear}`}
                  fill={yoyKind === "expense" ? "#EF4444" : "#10B981"}
                  radius={[4, 4, 0, 0]}
                  activeBar={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Seasonality */}
      {seasonality.some((s) => s.yearsSampled >= 2) && (
        <div className="card card-pad">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <div className="font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-warn" />
                Сезонность расходов
              </div>
              <div className="text-xs text-muted">
                Средний расход по месяцу года, цветом — отклонение от общего среднего
              </div>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={seasonality}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis dataKey="monthName" stroke={chartAxisStroke} fontSize={11} />
                <YAxis
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(v) => formatNum(v, { compact: true })}
                />
                <Tooltip
                  {...chartTooltipProps}
                  formatter={(v: unknown, _n: unknown, p: { payload?: { expenseDeviationPct?: number; yearsSampled?: number } }) => {
                    const dev = p.payload?.expenseDeviationPct ?? 0;
                    const ys = p.payload?.yearsSampled ?? 0;
                    return [
                      `${formatMoney(toNum(v), base, { compact: true })} · ${dev > 0 ? "+" : ""}${(dev * 100).toFixed(0)}% · ${ys} год${ys === 1 ? "" : "а"} в выборке`,
                      "Расход",
                    ];
                  }}
                />
                <ReferenceLine y={0} stroke={chartGridStroke} />
                <Bar dataKey="avgExpense" radius={[4, 4, 0, 0]} activeBar={false}>
                  {seasonality.map((s, i) => {
                    const dev = s.expenseDeviationPct;
                    const color =
                      dev > 0.15 ? "#EF4444" : dev < -0.15 ? "#10B981" : "#A78BFA";
                    return <Cell key={i} fill={color} />;
                  })}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs mt-3">
            {(() => {
              const sorted = [...seasonality].sort(
                (a, b) => Math.abs(b.expenseDeviationPct) - Math.abs(a.expenseDeviationPct)
              );
              const items = sorted
                .filter((s) => s.yearsSampled >= 2 && Math.abs(s.expenseDeviationPct) > 0.1)
                .slice(0, 3);
              return items.map((s) => (
                <div
                  key={s.monthIdx}
                  className={`p-2 rounded ${s.expenseDeviationPct > 0 ? "bg-expense/10 text-expense" : "bg-income/10 text-income"}`}
                >
                  <strong>{s.monthName}</strong>:{" "}
                  {s.expenseDeviationPct > 0 ? "выше" : "ниже"} среднего на{" "}
                  {(Math.abs(s.expenseDeviationPct) * 100).toFixed(0)}%
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      <div className="card card-pad">
        <div className="font-semibold mb-3">Помесячная сводка</div>
        <SortableTable<MonthBucket>
          data={months}
          rowKey={(m) => m.ym}
          defaultSortKey="ym"
          defaultSortDir="desc"
          onRowClick={(m) => openMonth(m.ym)}
          exportName="cashflow_monthly"
          columns={[
            {
              key: "ym",
              label: "Месяц",
              sortValue: (m) => m.ym,
              render: (m) => <span className="font-medium">{monthLabel(m.ym)}</span>,
            },
            {
              key: "income",
              label: "Доходы",
              align: "right",
              sortValue: (m) => m.income,
              render: (m) => (
                <span className="tabular-nums text-income">
                  {formatMoney(m.income, base, { compact: true })}
                </span>
              ),
            },
            {
              key: "expense",
              label: "Расходы",
              align: "right",
              sortValue: (m) => m.expense,
              render: (m) => (
                <span className="tabular-nums text-expense">
                  {formatMoney(m.expense, base, { compact: true })}
                </span>
              ),
            },
            {
              key: "net",
              label: "Чистый",
              align: "right",
              sortValue: (m) => m.net,
              render: (m) => (
                <span
                  className={`tabular-nums font-medium ${
                    m.net >= 0 ? "text-income" : "text-expense"
                  }`}
                >
                  {formatMoney(m.net, base, { compact: true, signed: true })}
                </span>
              ),
            },
            {
              key: "rate",
              label: "Норма сбер.",
              align: "right",
              sortValue: (m) => (m.income > 0 ? (m.income - m.expense) / m.income : -999),
              render: (m) => {
                const sr = m.income > 0 ? (m.income - m.expense) / m.income : 0;
                return (
                  <span className="tabular-nums text-muted">{(sr * 100).toFixed(0)}%</span>
                );
              },
            },
            {
              key: "count",
              label: "Операций",
              align: "right",
              sortValue: (m) => m.count,
              render: (m) => <span className="text-muted">{m.count}</span>,
            },
          ]}
        />
      </div>
    </div>
  );
}
