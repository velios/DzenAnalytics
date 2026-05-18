import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toPng } from "html-to-image";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  Tooltip,
  ComposedChart,
  Bar,
  Line,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  PiggyBank,
  ArrowRight,
  CalendarDays,
  Repeat,
  Hash,
  GitCompare,
  PieChart,
  TrendingDown as Down,
  Camera,
  Loader2,
} from "lucide-react";
import { useEffect } from "react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useCategoryFlagsStore } from "../store/useCategoryFlagsStore";
import { useAnnotationsStore } from "../store/useAnnotationsStore";
import {
  groupByMonth,
  groupByCategory,
  netWorthSeries,
  buildInsights,
  detectRecurring,
  topTransactions,
  dailyExpenseMap,
  buildForecast,
  applyCategoryFlags,
  balancesByAccount,
} from "../lib/aggregations";
import {
  getLiveAccountsFromCache,
  type LiveAccount,
} from "../store/useZenmoneyStore";
import {
  formatMoney,
  formatNum,
  formatPct,
  formatDate,
  monthLabel,
  toNum,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
  ymdKey,
} from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { InsightsPanel } from "../components/InsightsPanel";
import { QuickCalibration } from "../components/QuickCalibration";
import type { DayCell } from "../lib/aggregations";

const HEATMAP_COLORS = [
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

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function buildBins(values: number[], n = 8): number[] {
  const positives = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (positives.length === 0) return [];
  const out: number[] = [];
  for (let i = 1; i <= n - 1; i++) {
    const idx = Math.floor((i / n) * positives.length);
    out.push(positives[Math.min(idx, positives.length - 1)]);
  }
  return out;
}

function binIndex(v: number, thresholds: number[]): number {
  if (v <= 0) return 0;
  if (thresholds.length === 0) return v > 0 ? HEATMAP_COLORS.length - 1 : 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (v <= thresholds[i]) return i + 1;
  }
  return HEATMAP_COLORS.length - 1;
}

function MiniHeatmap({
  dayMap,
  days = 90,
  base,
}: {
  dayMap: Map<string, DayCell>;
  days?: number;
  base: string;
}) {
  const today = new Date();
  const cells: { date: string; cell?: DayCell }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = ymdKey(d.toISOString().slice(0, 10));
    cells.push({ date: key, cell: dayMap.get(key) });
  }

  const thresholds = buildBins(
    cells.map((c) => c.cell?.expense || 0),
    HEATMAP_COLORS.length - 1
  );

  const startDow = (new Date(cells[0].date).getDay() + 6) % 7;
  const totalSlots = startDow + cells.length;
  const numCols = Math.ceil(totalSlots / 7);

  const grid: ({ date: string; cell?: DayCell } | null)[][] = Array.from(
    { length: 7 },
    () => Array(numCols).fill(null)
  );

  let slot = startDow;
  for (const c of cells) {
    const row = slot % 7;
    const col = Math.floor(slot / 7);
    grid[row][col] = c;
    slot++;
  }

  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  for (let col = 0; col < numCols; col++) {
    for (let row = 0; row < 7; row++) {
      const c = grid[row][col];
      if (c?.date) {
        const m = new Date(c.date).getMonth();
        if (m !== lastMonth) {
          monthLabels.push({ col, label: MONTH_SHORT[m] });
          lastMonth = m;
        }
        break;
      }
    }
  }

  return (
    <div className="flex gap-1.5">
      <div className="flex flex-col gap-[2px] pt-4 shrink-0">
        {WEEKDAY_LABELS.map((w, i) => (
          <div
            key={w}
            className="text-[10px] text-muted leading-none flex items-center"
            style={{ height: "calc((100% - 12px) / 7)", minHeight: 14 }}
          >
            {i % 2 === 1 ? w : ""}
          </div>
        ))}
      </div>
      <div className="flex-1 flex flex-col gap-[2px]">
        <div className="flex gap-[2px] h-3 relative">
          {monthLabels.map((m) => (
            <div
              key={m.col}
              className="text-[10px] text-muted absolute"
              style={{ left: `calc(${(m.col / numCols) * 100}% + 1px)` }}
            >
              {m.label}
            </div>
          ))}
        </div>
        {grid.map((row, i) => (
          <div key={i} className="flex gap-[2px]">
            {row.map((c, j) => {
              const v = c?.cell?.expense || 0;
              const idx = binIndex(v, thresholds);
              return (
                <div
                  key={j}
                  title={
                    c?.date
                      ? `${formatDate(c.date)}: ${
                          c.cell ? formatMoney(c.cell.expense, base, { compact: true }) : "—"
                        }${c.cell ? ` · ${c.cell.count} оп.` : ""}`
                      : ""
                  }
                  className="flex-1 aspect-square rounded-[3px] border border-border/30"
                  style={{
                    background: c ? HEATMAP_COLORS[idx] : "transparent",
                    borderColor: c ? undefined : "transparent",
                  }}
                />
              );
            })}
          </div>
        ))}
        <div className="flex items-center justify-end gap-1.5 mt-2 text-[10px] text-muted">
          <span>меньше</span>
          {HEATMAP_COLORS.map((c, i) => (
            <span
              key={i}
              className="w-2.5 h-2.5 rounded-[2px] border border-border/30"
              style={{ background: c }}
            />
          ))}
          <span>больше</span>
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const showDrill = useDrillStore((s) => s.show);
  const calibration = useCalibrationStore((s) => s.calibration);
  const hydrateCalibration = useCalibrationStore((s) => s.hydrate);
  const calibLoaded = useCalibrationStore((s) => s.loaded);
  const flags = useCategoryFlagsStore((s) => s.flags);
  const flagsHydrate = useCategoryFlagsStore((s) => s.hydrate);
  const flagsLoaded = useCategoryFlagsStore((s) => s.loaded);
  const annotations = useAnnotationsStore((s) => s.annotations);
  const annHydrate = useAnnotationsStore((s) => s.hydrate);
  const annLoaded = useAnnotationsStore((s) => s.loaded);
  useEffect(() => {
    if (!calibLoaded) hydrateCalibration();
    if (!flagsLoaded) flagsHydrate();
    if (!annLoaded) annHydrate();
  }, [calibLoaded, hydrateCalibration, flagsLoaded, flagsHydrate, annLoaded, annHydrate]);

  const months = useMemo(() => groupByMonth(transactions), [transactions]);
  const forecast = useMemo(() => buildForecast(transactions, 3, 6), [transactions]);
  const netWorth = useMemo(
    () => netWorthSeries(transactions, calibration),
    [transactions, calibration]
  );
  const cats = useMemo(() => groupByCategory(transactions, "top"), [transactions]);
  const insights = useMemo(() => buildInsights(transactions), [transactions]);
  const recurring = useMemo(() => detectRecurring(transactions), [transactions]);
  const topTx = useMemo(() => topTransactions(transactions, "expense", 5), [transactions]);
  const flagsBreakdown = useMemo(() => {
    const fixed = new Set<string>();
    const disc = new Set<string>();
    for (const [cat, flag] of Object.entries(flags)) {
      if (flag === "fixed") fixed.add(cat);
      else if (flag === "discretionary") disc.add(cat);
    }
    const lastMonthYM = months[months.length - 1]?.ym;
    const lastTxs = lastMonthYM
      ? transactions.filter((t) => t.date.startsWith(lastMonthYM))
      : transactions;
    return applyCategoryFlags(lastTxs, fixed, disc);
  }, [flags, months, transactions]);
  const dayMap = useMemo(() => dailyExpenseMap(transactions), [transactions]);

  // Account balances. If the Zenmoney cache is present, prefer real
  // per-account balances from the API (they include startBalance and any
  // server-side reconciliation). Otherwise fall back to the CSV-style
  // flow-derived totals.
  const [liveAccounts, setLiveAccounts] = useState<LiveAccount[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getLiveAccountsFromCache().then((data) => {
      if (!cancelled) setLiveAccounts(data);
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);
  const baseRates = useDataStore((s) => s.rates);
  const accountRows = useMemo(() => {
    if (liveAccounts && liveAccounts.length > 0) {
      // Convert to base currency and sort by |balance| desc.
      return liveAccounts
        .filter((a) => a.inBalance && !a.archive)
        .map((a) => ({
          title: a.title,
          balanceBase:
            a.currency === baseRates.base
              ? a.balance
              : a.balance * (baseRates.rates[a.currency] || 1),
          nativeBalance: a.balance,
          nativeCurrency: a.currency,
          type: a.type,
        }))
        .sort((a, b) => Math.abs(b.balanceBase) - Math.abs(a.balanceBase));
    }
    return balancesByAccount(transactions).map((a) => ({
      title: a.account,
      balanceBase: a.balance,
      nativeBalance: a.balance,
      nativeCurrency: base,
      type: "",
    }));
  }, [liveAccounts, transactions, base, baseRates]);
  const [showAllAccounts, setShowAllAccounts] = useState(false);
  function openAccount(title: string) {
    const txs = transactions.filter(
      (t) =>
        t.account === title ||
        t.outcomeAccount === title ||
        t.incomeAccount === title
    );
    showDrill(title, txs, "Операции по счёту");
  }

  if (transactions.length === 0) return <EmptyState />;

  const last = months[months.length - 1];
  const prev = months[months.length - 2];
  const lastNetWorth = netWorth.length ? netWorth[netWorth.length - 1].net : 0;
  const sr = last && last.income > 0 ? last.net / last.income : null;
  const expDelta = last && prev && prev.expense > 0 ? (last.expense - prev.expense) / prev.expense : null;
  const incDelta = last && prev && prev.income > 0 ? (last.income - prev.income) / prev.income : null;

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = recurring
    .filter((r) => r.nextExpected >= today)
    .sort((a, b) => a.nextExpected.localeCompare(b.nextExpected))
    .slice(0, 5);

  function openTx(id: string) {
    const tx = transactions.find((t) => t.id === id);
    if (!tx) return;
    showDrill(tx.payee || tx.categoryFull, [tx], "Операция");
  }

  function openCategory(name: string) {
    const txs = transactions.filter((t) => t.kind === "expense" && t.category === name);
    showDrill(name, txs, "Расходы по категории");
  }

  function openMonth(ym: string) {
    const txs = transactions.filter((t) => t.date.startsWith(ym));
    showDrill(monthLabel(ym), txs, "Месяц");
  }

  const forecastChart = forecast.map((p) => ({
    month: monthLabel(p.ym),
    ym: p.ym,
    income: p.isForecast ? null : Math.round(p.income),
    expense: p.isForecast ? null : Math.round(p.expense),
    incomeF: p.isForecast ? Math.round(p.income) : null,
    expenseF: p.isForecast ? Math.round(p.expense) : null,
    net: Math.round(p.net),
  }));

  const netWorthChart = netWorth.map((p) => ({ date: p.date, net: Math.round(p.net) }));

  const totalRecurringMonthly = recurring.reduce(
    (s, c) => s + (c.avgIntervalDays > 0 ? (c.avgAmount * 30) / c.avgIntervalDays : 0),
    0
  );

  const exportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  async function exportPng() {
    if (!exportRef.current) return;
    setExporting(true);
    try {
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--c-bg").trim();
      const dataUrl = await toPng(exportRef.current, {
        backgroundColor: `rgb(${bg})`,
        pixelRatio: 2,
        cacheBust: true,
        filter: (node) => {
          const el = node as HTMLElement;
          if (el.dataset && el.dataset.exportSkip === "1") return false;
          return true;
        },
      });
      const a = document.createElement("a");
      a.download = `dzenanalytics-dashboard-${new Date().toISOString().slice(0, 10)}.png`;
      a.href = dataUrl;
      a.click();
    } catch (e) {
      alert(`Не удалось экспортировать: ${e instanceof Error ? e.message : "ошибка"}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6" ref={exportRef}>
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Главная</h1>
          <p className="text-muted text-sm mt-1">
            Обзор финансов: ключевые метрики, тренды, прогноз и быстрые переходы
          </p>
        </div>
        <button
          data-export-skip="1"
          onClick={exportPng}
          disabled={exporting}
          className="btn-ghost text-xs"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
          {exporting ? "Сохраняю..." : "Снимок PNG"}
        </button>
      </div>

      <div data-export-skip="1">
        <QuickCalibration />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card card-pad">
          <div className="flex items-start justify-between mb-2">
            <div className="label">Совокупный баланс</div>
            <Wallet className="w-4 h-4 text-muted" />
          </div>
          <div className={`stat-num ${lastNetWorth >= 0 ? "text-income" : "text-expense"}`}>
            {formatMoney(lastNetWorth, base, { compact: true, signed: true })}
          </div>
          <div className="text-xs text-muted mt-1">
            {calibration ? `Откалибровано на ${calibration.date}` : "от 0 в начале истории"}
          </div>
        </div>

        <button
          onClick={() => last && openMonth(last.ym)}
          className="card card-pad text-left hover:border-accent transition-colors"
        >
          <div className="flex items-start justify-between mb-2">
            <div className="label">Доход {last ? monthLabel(last.ym) : ""}</div>
            <TrendingUp className="w-4 h-4 text-income" />
          </div>
          <div className="stat-num text-income">
            {last ? formatMoney(last.income, base, { compact: true }) : "—"}
          </div>
          {incDelta !== null && (
            <div className={`text-xs mt-1 ${incDelta >= 0 ? "text-income" : "text-muted"}`}>
              {incDelta >= 0 ? "↑" : "↓"} {formatPct(Math.abs(incDelta), 1)} к пред. месяцу
            </div>
          )}
        </button>

        <button
          onClick={() => last && openMonth(last.ym)}
          className="card card-pad text-left hover:border-accent transition-colors"
        >
          <div className="flex items-start justify-between mb-2">
            <div className="label">Расход {last ? monthLabel(last.ym) : ""}</div>
            <TrendingDown className="w-4 h-4 text-expense" />
          </div>
          <div className="stat-num text-expense">
            {last ? formatMoney(last.expense, base, { compact: true }) : "—"}
          </div>
          {expDelta !== null && (
            <div className={`text-xs mt-1 ${expDelta <= 0 ? "text-income" : "text-warn"}`}>
              {expDelta >= 0 ? "↑" : "↓"} {formatPct(Math.abs(expDelta), 1)} к пред. месяцу
            </div>
          )}
        </button>

        <div className="card card-pad">
          <div className="flex items-start justify-between mb-2">
            <div className="label">Норма сбережений</div>
            <PiggyBank className="w-4 h-4 text-muted" />
          </div>
          <div className={`stat-num ${sr !== null && sr > 0 ? "text-income" : "text-expense"}`}>
            {sr !== null ? `${(sr * 100).toFixed(0)}%` : "—"}
          </div>
          <div className="text-xs text-muted mt-1">
            {sr !== null && last
              ? `Чистый: ${formatMoney(last.net, base, { compact: true, signed: true })}`
              : "—"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card card-pad lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-semibold">Cash-flow с прогнозом</div>
              <div className="text-xs text-muted">
                История + 3 мес прогноз (среднее за последние 6 мес)
              </div>
            </div>
            <Link to="/cashflow" className="text-xs text-accent hover:underline flex items-center gap-1">
              подробнее <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={forecastChart} onClick={(e: unknown) => {
                const ev = e as { activePayload?: { payload?: { ym?: string; isForecast?: boolean } }[] } | undefined;
                const ym = ev?.activePayload?.[0]?.payload?.ym;
                const isF = forecast.find((p) => p.ym === ym)?.isForecast;
                if (ym && !isF) openMonth(ym);
              }} style={{ cursor: "pointer" }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis dataKey="month" stroke={chartAxisStroke} fontSize={11} />
                <YAxis stroke={chartAxisStroke} fontSize={11} tickFormatter={(v) => formatNum(v, { compact: true })} />
                <Tooltip
                  {...chartTooltipProps}
                  formatter={(v: unknown) => formatMoney(toNum(v), base, { compact: true })}
                />
                <Bar dataKey="income" name="Доход" fill="#10B981" radius={[4, 4, 0, 0]} activeBar={false} />
                <Bar dataKey="expense" name="Расход" fill="#EF4444" radius={[4, 4, 0, 0]} activeBar={false} />
                <Bar dataKey="incomeF" name="Прогноз дох." fill="#10B981" fillOpacity={0.35} stroke="#10B981" strokeDasharray="3 3" radius={[4, 4, 0, 0]} activeBar={false} />
                <Bar dataKey="expenseF" name="Прогноз расх." fill="#EF4444" fillOpacity={0.35} stroke="#EF4444" strokeDasharray="3 3" radius={[4, 4, 0, 0]} activeBar={false} />
                <Line type="monotone" dataKey="net" name="Чистый" stroke="#22D3EE" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">Совокупный баланс</div>
            <Link to="/accounts" className="text-xs text-accent hover:underline flex items-center gap-1">
              счета <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={netWorthChart}>
                <defs>
                  <linearGradient id="dashNw" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#22D3EE" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis
                  dataKey="date"
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(d) => formatDate(d, "short")}
                  minTickGap={50}
                />
                <Tooltip
                  {...chartTooltipProps}
                  labelFormatter={(d) => formatDate(d as string)}
                  formatter={(v: unknown) => [formatMoney(toNum(v), base, { compact: true, signed: true }), "Баланс"]}
                />
                <Area type="monotone" dataKey="net" stroke="#22D3EE" strokeWidth={2} fill="url(#dashNw)" />
                {annotations.map((a) => (
                  <ReferenceLine
                    key={a.id}
                    x={a.date}
                    stroke={a.color || "#A78BFA"}
                    strokeDasharray="2 2"
                    label={{ value: a.title, position: "top", fontSize: 9, fill: a.color || "#A78BFA" }}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {insights.length > 0 && <InsightsPanel insights={insights.slice(0, 6)} base={base} />}

      {(flagsBreakdown.fixed > 0 || flagsBreakdown.discretionary > 0) && (
        <div className="card card-pad">
          <div className="font-semibold mb-2">Структура расходов последнего месяца</div>
          <div className="text-xs text-muted mb-3">
            На основе флагов категорий (страница «Категории»). «Свободные деньги» = доход − фиксированные расходы.
          </div>
          {(() => {
            const totalSpend = flagsBreakdown.fixed + flagsBreakdown.discretionary + flagsBreakdown.unflagged;
            const lastIncome = months[months.length - 1]?.income || 0;
            const freedom = lastIncome - flagsBreakdown.fixed;
            return (
              <>
                <div className="h-6 flex rounded-md overflow-hidden bg-panel2 mb-2">
                  {flagsBreakdown.fixed > 0 && (
                    <div
                      className="bg-warn"
                      style={{ width: `${(flagsBreakdown.fixed / totalSpend) * 100}%` }}
                      title={`Фиксированные: ${formatMoney(flagsBreakdown.fixed, base, { compact: true })}`}
                    />
                  )}
                  {flagsBreakdown.discretionary > 0 && (
                    <div
                      className="bg-accent2"
                      style={{ width: `${(flagsBreakdown.discretionary / totalSpend) * 100}%` }}
                      title={`Дискретные: ${formatMoney(flagsBreakdown.discretionary, base, { compact: true })}`}
                    />
                  )}
                  {flagsBreakdown.unflagged > 0 && (
                    <div
                      className="bg-border"
                      style={{ width: `${(flagsBreakdown.unflagged / totalSpend) * 100}%` }}
                      title={`Без флага: ${formatMoney(flagsBreakdown.unflagged, base, { compact: true })}`}
                    />
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="label flex items-center gap-1">
                      <span className="w-2 h-2 rounded bg-warn" /> Фиксированные
                    </div>
                    <div className="font-semibold tabular-nums">
                      {formatMoney(flagsBreakdown.fixed, base, { compact: true })}
                    </div>
                  </div>
                  <div>
                    <div className="label flex items-center gap-1">
                      <span className="w-2 h-2 rounded bg-accent2" /> Дискретные
                    </div>
                    <div className="font-semibold tabular-nums">
                      {formatMoney(flagsBreakdown.discretionary, base, { compact: true })}
                    </div>
                  </div>
                  <div>
                    <div className="label flex items-center gap-1">
                      <span className="w-2 h-2 rounded bg-border" /> Без флага
                    </div>
                    <div className="font-semibold tabular-nums text-muted">
                      {formatMoney(flagsBreakdown.unflagged, base, { compact: true })}
                    </div>
                  </div>
                  <div>
                    <div className="label">«Свободные деньги»</div>
                    <div
                      className={`font-semibold tabular-nums ${
                        freedom > 0 ? "text-income" : "text-expense"
                      }`}
                    >
                      {formatMoney(freedom, base, { compact: true, signed: true })}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold flex items-center gap-2">
              <PieChart className="w-4 h-4 text-accent" />
              Топ-7 категорий расходов
            </div>
            <Link to="/categories" className="text-xs text-accent hover:underline flex items-center gap-1">
              все <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {cats.slice(0, 7).map((c) => {
              const pct = cats[0].expense > 0 ? c.expense / cats[0].expense : 0;
              return (
                <button
                  key={c.category}
                  onClick={() => openCategory(c.category)}
                  className="w-full text-left text-sm group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="truncate group-hover:text-accent">{c.category}</span>
                    <span className="tabular-nums text-xs">
                      {formatMoney(c.expense, base, { compact: true })}
                    </span>
                  </div>
                  <div className="h-1.5 bg-panel2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-expense rounded-full transition-all"
                      style={{ width: `${pct * 100}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-muted mt-0.5">
                    {c.count} оп.
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold flex items-center gap-2">
              <Down className="w-4 h-4 text-expense" />
              Крупнейшие траты
            </div>
            <Link to="/top" className="text-xs text-accent hover:underline flex items-center gap-1">
              топ <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {topTx.map((t) => (
              <button
                key={t.id}
                onClick={() => openTx(t.id)}
                className="w-full text-left p-2 -mx-2 rounded hover:bg-panel2/60 group"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate group-hover:text-accent">
                      {t.payee || t.categoryFull}
                    </div>
                    <div className="text-xs text-muted truncate">
                      {formatDate(t.date, "short")} · {t.categoryFull}
                    </div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums text-expense whitespace-nowrap">
                    −{formatMoney(t.amount, t.currency)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Account balances */}
      {accountRows.length > 0 && (
        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="font-semibold flex items-center gap-2">
              <Wallet className="w-4 h-4 text-accent" />
              Балансы счетов{" "}
              <span className="text-muted text-xs font-normal">
                {liveAccounts && liveAccounts.length > 0
                  ? "· реальные из Дзен-мани"
                  : "· по данным операций"}
              </span>
            </div>
            <Link
              to="/accounts"
              className="text-xs text-accent hover:underline flex items-center gap-1"
            >
              все <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {(showAllAccounts ? accountRows : accountRows.slice(0, 8)).map((a) => {
              const isNegative = a.balanceBase < 0;
              const hasFx = a.nativeCurrency !== base;
              return (
                <button
                  key={a.title}
                  onClick={() => openAccount(a.title)}
                  className="text-left p-3 rounded-lg border border-border bg-panel2/30 hover:bg-panel2/70 hover:border-accent/50 transition-colors group"
                >
                  <div
                    className="text-xs text-muted truncate mb-1"
                    title={a.title}
                  >
                    {a.title}
                  </div>
                  <div
                    className={`font-semibold tabular-nums text-sm ${
                      isNegative ? "text-expense" : "text-text"
                    } group-hover:text-accent`}
                  >
                    {formatMoney(a.balanceBase, base, { compact: true })}
                  </div>
                  {hasFx && (
                    <div className="text-[10px] text-muted tabular-nums mt-0.5">
                      {formatMoney(a.nativeBalance, a.nativeCurrency, {
                        compact: true,
                      })}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {accountRows.length > 8 && (
            <button
              onClick={() => setShowAllAccounts((v) => !v)}
              className="btn-ghost text-xs mt-3 mx-auto block text-muted"
            >
              {showAllAccounts
                ? "Свернуть"
                : `Показать ещё ${accountRows.length - 8}`}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold flex items-center gap-2">
              <Repeat className="w-4 h-4 text-accent" />
              Ближайшие регулярные
            </div>
            <Link to="/recurring" className="text-xs text-accent hover:underline flex items-center gap-1">
              все ({recurring.length}) <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <div className="text-sm text-muted text-center py-6">
              Нет ожидаемых регулярных платежей
            </div>
          ) : (
            <div className="space-y-2">
              {upcoming.map((c) => {
                const days = Math.round((+new Date(c.nextExpected) - +new Date(today)) / 86400000);
                return (
                  <div
                    key={c.payee + c.currency}
                    className="flex items-center justify-between p-2 -mx-2 rounded bg-panel2/40"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{c.payee}</div>
                      <div className="text-xs text-muted">
                        {formatDate(c.nextExpected, "short")} · {days === 0 ? "сегодня" : `через ${days} дн`}
                      </div>
                    </div>
                    <div className="text-sm font-semibold tabular-nums text-expense whitespace-nowrap">
                      ≈ {formatMoney(c.avgAmount, c.currency, { compact: true })}
                    </div>
                  </div>
                );
              })}
              <div className="mt-3 pt-3 border-t border-border text-xs text-muted">
                ≈ {formatMoney(totalRecurringMonthly, base, { compact: true })} / мес всего на регулярные
              </div>
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-accent" />
              Активность за 90 дней
            </div>
            <Link to="/calendar" className="text-xs text-accent hover:underline flex items-center gap-1">
              календарь <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <MiniHeatmap dayMap={dayMap} days={90} base={base} />
          <div className="text-xs text-muted mt-3">
            Цвет — интенсивность расходов по дням
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link to="/calendar" className="card card-pad hover:border-accent transition-colors flex items-center gap-3">
          <CalendarDays className="w-5 h-5 text-accent" />
          <div>
            <div className="font-medium text-sm">Календарь</div>
            <div className="text-xs text-muted">Heatmap по дням</div>
          </div>
        </Link>
        <Link to="/tags" className="card card-pad hover:border-accent transition-colors flex items-center gap-3">
          <Hash className="w-5 h-5 text-accent" />
          <div>
            <div className="font-medium text-sm">Хэштеги</div>
            <div className="text-xs text-muted">Из комментариев</div>
          </div>
        </Link>
        <Link to="/compare" className="card card-pad hover:border-accent transition-colors flex items-center gap-3">
          <GitCompare className="w-5 h-5 text-accent" />
          <div>
            <div className="font-medium text-sm">Сравнение</div>
            <div className="text-xs text-muted">Периоды</div>
          </div>
        </Link>
        <Link to="/recurring" className="card card-pad hover:border-accent transition-colors flex items-center gap-3">
          <Repeat className="w-5 h-5 text-accent" />
          <div>
            <div className="font-medium text-sm">Регулярные</div>
            <div className="text-xs text-muted">{recurring.length} найдено</div>
          </div>
        </Link>
      </div>
    </div>
  );
}
