import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ComposedChart,
  Line,
} from "recharts";
import {
  Wallet,
  List,
  Layers,
  LineChart as LineChartIcon,
  Settings2,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useDrillStore } from "../store/useDrillStore";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import {
  balancesByAccount,
  dailyBalanceSeries,
  stackedBalanceByAccount,
  netWorthSeries,
  accountMonthlyDeltas,
  detectBalanceAnchors,
  cumulativeNetAt,
  lastTransactionDate,
} from "../lib/aggregations";
import {
  formatMoney,
  formatNum,
  formatDate,
  toNum,
  chartTooltipProps,
  chartGridStroke,
  chartAxisStroke,
} from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { Sparkline } from "../components/Sparkline";

const STACK_COLORS = [
  "#22D3EE", "#A78BFA", "#F59E0B", "#10B981", "#EC4899",
  "#3B82F6", "#84CC16", "#F97316", "#14B8A6", "#6B7280",
];

type View = "stacked" | "single";
type Scope = "filtered" | "all";

export function AccountsPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();

  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [view, setView] = useState<View>("stacked");
  const [scope, setScope] = useState<Scope>("all");

  const showDrill = useDrillStore((s) => s.show);
  const calibration = useCalibrationStore((s) => s.calibration);
  const setCalibration = useCalibrationStore((s) => s.set);
  const clearCalibration = useCalibrationStore((s) => s.clear);
  const hydrateCalibration = useCalibrationStore((s) => s.hydrate);
  // API auto-calibrates on every sync — hide the manual UI when connected.
  const zenToken = useZenmoneyStore((s) => s.token);
  const zenHydrate = useZenmoneyStore((s) => s.hydrate);
  const zenLoaded = useZenmoneyStore((s) => s.loaded);
  useEffect(() => {
    if (!zenLoaded) zenHydrate();
  }, [zenLoaded, zenHydrate]);
  const calibLoaded = useCalibrationStore((s) => s.loaded);

  useEffect(() => {
    if (!calibLoaded) hydrateCalibration();
  }, [calibLoaded, hydrateCalibration]);

  const [calibOpen, setCalibOpen] = useState(false);
  const [calibDate, setCalibDate] = useState(calibration?.date || "");
  const [calibAmount, setCalibAmount] = useState(
    calibration ? String(calibration.amount) : ""
  );

  useEffect(() => {
    setCalibDate(calibration?.date || "");
    setCalibAmount(calibration ? String(calibration.amount) : "");
  }, [calibration]);

  const filtered = useMemo(() => applyFilters(transactions, filters), [transactions, filters]);
  const baseTxs = scope === "all" ? transactions : filtered;

  const accounts = useMemo(() => balancesByAccount(filtered), [filtered]);
  const accountsAll = useMemo(() => balancesByAccount(transactions), [transactions]);
  const series = useMemo(
    () => dailyBalanceSeries(filtered, selectedAccount ?? undefined),
    [filtered, selectedAccount]
  );
  const stacked = useMemo(() => stackedBalanceByAccount(baseTxs, 8), [baseTxs]);
  const netWorth = useMemo(() => netWorthSeries(baseTxs, calibration), [baseTxs, calibration]);

  function applyCalibration() {
    const amt = Number(calibAmount);
    if (!calibDate || !Number.isFinite(amt)) return;
    setCalibration({ date: calibDate, amount: amt });
    setCalibOpen(false);
  }

  function calibrateForToday() {
    const lastDate = lastTransactionDate(transactions);
    if (lastDate) setCalibDate(lastDate);
  }

  const lastDateOverall = useMemo(() => lastTransactionDate(transactions), [transactions]);
  const rawAtCalibDate = useMemo(
    () => (calibDate ? cumulativeNetAt(transactions, calibDate) : 0),
    [transactions, calibDate]
  );
  const anchors = useMemo(() => detectBalanceAnchors(transactions), [transactions]);

  function applyAnchor() {
    if (anchors.length === 0) return;
    const a = anchors[0];
    const cum = cumulativeNetAt(transactions, a.tx.date);
    setCalibration({ date: a.tx.date, amount: cum + a.amount });
    setCalibOpen(false);
  }

  function openAccount(account: string) {
    const txs = filtered.filter(
      (t) => t.outcomeAccount === account || t.incomeAccount === account
    );
    showDrill(account, txs, "Операции по счёту");
  }

  if (transactions.length === 0) return <EmptyState />;

  const totalNet = accounts.reduce((s, a) => s + a.balance, 0);
  const totalIncome = accounts.reduce((s, a) => s + a.income, 0);
  const totalExpense = accounts.reduce((s, a) => s + a.expense, 0);

  const totalAllAccounts = accountsAll.reduce((s, a) => s + a.balance, 0);
  const peakNetWorth = netWorth.reduce((m, p) => Math.max(m, p.net), 0);
  const lastNetWorth = netWorth.length ? netWorth[netWorth.length - 1].net : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Совокупный баланс</h1>
          <p className="text-muted text-sm mt-1">
            {zenToken
              ? "Совокупный баланс подтянут из Дзен-мани, обновляется при каждой синхронизации."
              : calibration
                ? `Откалибровано: на ${calibration.date} баланс был ${calibration.amount.toLocaleString("ru-RU")} ${base}.`
                : "Стартовая точка — 0 (CSV не содержит начальных остатков). Используйте калибровку, чтобы привязать график к реальной сумме."}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex bg-panel2 rounded-lg p-1 border border-border">
            <button
              onClick={() => setScope("all")}
              className={`px-3 py-1 text-xs rounded-md ${scope === "all" ? "bg-accent text-accent-fg" : "text-muted"}`}
            >
              Вся история
            </button>
            <button
              onClick={() => setScope("filtered")}
              className={`px-3 py-1 text-xs rounded-md ${scope === "filtered" ? "bg-accent text-accent-fg" : "text-muted"}`}
            >
              По фильтрам
            </button>
          </div>
          <div className="flex bg-panel2 rounded-lg p-1 border border-border">
            <button
              onClick={() => setView("stacked")}
              className={`px-3 py-1 text-xs rounded-md flex items-center gap-1 ${view === "stacked" ? "bg-accent text-accent-fg" : "text-muted"}`}
            >
              <Layers className="w-3 h-3" />
              По счетам
            </button>
            <button
              onClick={() => setView("single")}
              className={`px-3 py-1 text-xs rounded-md flex items-center gap-1 ${view === "single" ? "bg-accent text-accent-fg" : "text-muted"}`}
            >
              <LineChartIcon className="w-3 h-3" />
              Совокупно
            </button>
          </div>
          {!zenToken && (
            <button
              onClick={() => setCalibOpen((o) => !o)}
              className={`btn-ghost text-xs ${calibration ? "border-accent2 text-accent2" : ""}`}
              title="Привязать график к фактическому балансу"
            >
              <Settings2 className="w-3.5 h-3.5" />
              {calibration ? "Калибровка вкл." : "Калибровка"}
            </button>
          )}
        </div>
      </div>

      {calibOpen && !zenToken && (
        <div className="card card-pad bg-accent2/5 border-accent2/40">
          <div className="font-semibold mb-2 flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-accent2" />
            Калибровка совокупного баланса
          </div>
          <p className="text-xs text-muted mb-4">
            CSV не содержит начальных остатков счетов — поэтому без калибровки график показывает
            <em> изменение</em> богатства, а не реальный баланс. Введите вашу <b>текущую</b> сумму
            на всех счетах — весь график сдвинется так, чтобы на эту дату показал указанное
            значение.
          </p>

          {anchors.length > 0 && (
            <div className="mb-3 p-3 rounded-lg bg-panel2 border border-border flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">
                  В данных найдены {anchors.length} «якорных» операций
                </div>
                <div className="text-xs text-muted mt-1">
                  Дзен-мани иногда экспортирует «Корректировка остатка» / «Начальный остаток» как
                  обычные транзакции. Самая свежая:{" "}
                  {anchors[0].tx.date} · {anchors[0].tx.categoryFull}
                </div>
              </div>
              <button onClick={applyAnchor} className="btn-ghost text-xs whitespace-nowrap">
                Применить
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 mb-2">
            <button onClick={calibrateForToday} className="btn-ghost text-xs">
              Использовать дату последней операции
            </button>
            <span className="text-xs text-muted">
              ({lastDateOverall || "—"})
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <label className="label block mb-1">На дату</label>
              <input
                type="date"
                value={calibDate}
                onChange={(e) => setCalibDate(e.target.value)}
                className="input text-sm"
              />
            </div>
            <div>
              <label className="label block mb-1">У меня было ({base})</label>
              <input
                type="number"
                value={calibAmount}
                onChange={(e) => setCalibAmount(e.target.value)}
                placeholder="2900000"
                className="input text-sm"
              />
              {calibDate && (
                <div className="text-[11px] text-muted mt-1">
                  Сейчас график показывает{" "}
                  <span className="tabular-nums">
                    {formatMoney(rawAtCalibDate, base, { compact: true, signed: true })}
                  </span>{" "}
                  на эту дату
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={applyCalibration} className="btn-primary text-sm flex-1">
                <CheckCircle2 className="w-4 h-4" />
                Применить
              </button>
              {calibration && (
                <button
                  onClick={() => {
                    if (confirm("Сбросить калибровку?")) clearCalibration();
                  }}
                  className="btn-danger text-sm"
                  title="Сбросить"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="text-xs text-muted mt-3">
            Применяется только к графику «Совокупно» и KPI-карточке «Совокупный баланс».
            Сток-чарт «По счетам» остаётся «от нуля» — он показывает изменения, не остатки.
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card card-pad">
          <div className="label mb-1">Совокупный баланс</div>
          <div className={`stat-num ${lastNetWorth >= 0 ? "text-income" : "text-expense"}`}>
            {formatMoney(lastNetWorth, base, { compact: true, signed: true })}
          </div>
          <div className="text-xs text-muted mt-1">
            {scope === "all" ? "Вся история" : "В пределах фильтра"}
          </div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Пиковое значение</div>
          <div className="stat-num text-accent">
            {formatMoney(peakNetWorth, base, { compact: true })}
          </div>
          <div className="text-xs text-muted mt-1">Максимум за период графика</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Поступления (фильтр)</div>
          <div className="stat-num text-income">
            {formatMoney(totalIncome, base, { compact: true })}
          </div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Списания (фильтр)</div>
          <div className="stat-num text-expense">
            {formatMoney(totalExpense, base, { compact: true })}
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-semibold">
              {view === "stacked"
                ? "Баланс по счетам (стопкой)"
                : "Совокупный баланс (одной линией)"}
            </div>
            <div className="text-xs text-muted">
              {scope === "all" ? "Все транзакции, без учёта фильтров" : "С учётом фильтров"}
              {view === "stacked" && ` · топ-${stacked.accounts.length} счетов`}
            </div>
          </div>
        </div>
        <div className="h-96">
          {view === "stacked" ? (
            <ResponsiveContainer>
              <AreaChart data={stacked.series}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis
                  dataKey="date"
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(d) => formatDate(d, "short")}
                  minTickGap={50}
                />
                <YAxis
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(v) => formatNum(v, { compact: true })}
                />
                <Tooltip
                  {...chartTooltipProps}
                  labelFormatter={(d) => formatDate(d as string)}
                  formatter={(v: unknown) => formatMoney(toNum(v), base, { compact: true, signed: true })}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {stacked.accounts.map((acc, i) => (
                  <Area
                    key={acc}
                    type="monotone"
                    dataKey={acc}
                    stackId="1"
                    stroke={STACK_COLORS[i % STACK_COLORS.length]}
                    fill={STACK_COLORS[i % STACK_COLORS.length]}
                    fillOpacity={0.7}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer>
              <ComposedChart data={netWorth}>
                <defs>
                  <linearGradient id="netfill" x1="0" y1="0" x2="0" y2="1">
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
                <YAxis
                  stroke={chartAxisStroke}
                  fontSize={11}
                  tickFormatter={(v) => formatNum(v, { compact: true })}
                />
                <Tooltip
                  {...chartTooltipProps}
                  labelFormatter={(d) => formatDate(d as string)}
                  formatter={(v: unknown) => [
                    formatMoney(toNum(v), base, { compact: true, signed: true }),
                    "Баланс",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="net"
                  stroke="#22D3EE"
                  strokeWidth={2}
                  fill="url(#netfill)"
                />
                <Line type="monotone" dataKey="net" stroke="#22D3EE" strokeWidth={0} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card card-pad">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-semibold">
              {selectedAccount ? `Дельта по счёту: ${selectedAccount}` : "Дельта по фильтру"}
            </div>
            <div className="text-xs text-muted">
              Изменение баланса за период (нарастающим итогом)
            </div>
          </div>
          {selectedAccount && (
            <button onClick={() => setSelectedAccount(null)} className="btn-ghost text-xs">
              Все счета
            </button>
          )}
        </div>
        <div className="h-64">
          <ResponsiveContainer>
            <AreaChart data={series}>
              <defs>
                <linearGradient id="bal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#A78BFA" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#A78BFA" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
              <XAxis
                dataKey="date"
                stroke={chartAxisStroke}
                fontSize={11}
                tickFormatter={(d) => formatDate(d, "short")}
                minTickGap={40}
              />
              <YAxis
                stroke={chartAxisStroke}
                fontSize={11}
                tickFormatter={(v) => formatNum(v, { compact: true })}
              />
              <Tooltip
                {...chartTooltipProps}
                labelFormatter={(d) => formatDate(d as string)}
                formatter={(v: unknown, n: unknown) => [
                  formatMoney(toNum(v), base, { compact: true, signed: true }),
                  n === "balance" ? "Баланс" : "Дельта",
                ]}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="#A78BFA"
                strokeWidth={2}
                fill="url(#bal)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card card-pad">
          <div className="label mb-1">Чистая дельта (фильтр)</div>
          <div
            className={`stat-num ${totalNet >= 0 ? "text-income" : "text-expense"}`}
          >
            {formatMoney(totalNet, base, { compact: true, signed: true })}
          </div>
          <div className="text-xs text-muted mt-1">По текущим фильтрам</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Чистая дельта (вся история)</div>
          <div className={`stat-num ${totalAllAccounts >= 0 ? "text-income" : "text-expense"}`}>
            {formatMoney(totalAllAccounts, base, { compact: true, signed: true })}
          </div>
          <div className="text-xs text-muted mt-1">Без фильтров</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Счетов</div>
          <div className="stat-num">{accountsAll.length}</div>
          <div className="text-xs text-muted mt-1">{accounts.length} в фильтре</div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="font-semibold mb-3 flex items-center gap-2">
          <Wallet className="w-4 h-4" />
          Счета ({accounts.length})
        </div>
        <div className="text-xs text-muted mb-3">
          Клик по карточке — фильтр графика «Дельта» по счёту. Кнопка «Операции» — список транзакций.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {accounts.map((a) => (
            <div
              key={a.account}
              className={`p-4 rounded-lg border transition-colors ${
                selectedAccount === a.account
                  ? "bg-accent/10 border-accent"
                  : "bg-panel2 border-border hover:border-accent/50"
              }`}
            >
              <div className="flex items-start justify-between mb-2 gap-2">
                <button
                  onClick={() =>
                    setSelectedAccount(selectedAccount === a.account ? null : a.account)
                  }
                  className="font-medium text-sm truncate text-left flex-1"
                  title={a.account}
                >
                  {a.account}
                </button>
                <span className="pill text-[10px] shrink-0">{a.count}</span>
              </div>
              <button
                onClick={() =>
                  setSelectedAccount(selectedAccount === a.account ? null : a.account)
                }
                className="block text-left w-full"
              >
                <div className="flex items-center justify-between gap-2">
                  <div
                    className={`text-lg font-semibold tabular-nums ${
                      a.balance >= 0 ? "text-income" : "text-expense"
                    }`}
                  >
                    {formatMoney(a.balance, base, { compact: true, signed: true })}
                  </div>
                  <Sparkline
                    data={accountMonthlyDeltas(transactions, a.account, 12)}
                    color={a.balance >= 0 ? "rgb(var(--c-income))" : "rgb(var(--c-expense))"}
                    width={70}
                    height={20}
                  />
                </div>
                <div className="text-xs text-muted flex justify-between mt-1 mb-3">
                  <span>+ {formatMoney(a.income, base, { compact: true })}</span>
                  <span>− {formatMoney(a.expense, base, { compact: true })}</span>
                </div>
              </button>
              <button
                onClick={() => openAccount(a.account)}
                className="btn-ghost text-xs w-full !py-1.5"
              >
                <List className="w-3 h-3" />
                Операции
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
