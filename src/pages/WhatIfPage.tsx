import { useEffect, useMemo, useState } from "react";
import {
  FlaskConical,
  TrendingUp,
  TrendingDown,
  Flame,
  RotateCcw,
  Coins,
  PiggyBank,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useCalibrationStore } from "../store/useCalibrationStore";
import {
  computeWhatIfBase,
  computeWhatIf,
  avgMonthlyByCategory,
  type WhatIfInputs,
} from "../lib/whatif";
import { netWorthSeries } from "../lib/aggregations";
import { formatMoney, formatPct } from "../lib/format";
import { EmptyState } from "../components/EmptyState";

const INITIAL: WhatIfInputs = {
  incomeMul: 1,
  expenseMul: 1,
  extraMonthlySave: 0,
  startingCapital: 0,
  categoryMul: {},
};

function years(v: number): string {
  if (!Number.isFinite(v)) return "∞";
  if (v < 0) return "0";
  if (v < 1) return `${(v * 12).toFixed(0)} мес`;
  if (v >= 100) return "100+";
  return `${v.toFixed(1)}`;
}

export function WhatIfPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const calibration = useCalibrationStore((s) => s.calibration);
  const calibLoaded = useCalibrationStore((s) => s.loaded);
  const hydrateCalibration = useCalibrationStore((s) => s.hydrate);

  useEffect(() => {
    if (!calibLoaded) hydrateCalibration();
  }, [calibLoaded, hydrateCalibration]);

  const baseScenario = useMemo(() => computeWhatIfBase(transactions), [transactions]);
  const categories = useMemo(() => avgMonthlyByCategory(transactions, 8), [transactions]);

  const currentNetWorth = useMemo(() => {
    const series = netWorthSeries(transactions, calibration);
    return series.length > 0 ? series[series.length - 1].net : 0;
  }, [transactions, calibration]);

  const [inputs, setInputs] = useState<WhatIfInputs>(() => ({
    ...INITIAL,
    startingCapital: Math.max(0, Math.round(currentNetWorth)),
  }));

  // Sync starting capital when calibration changes (but only if user hasn't touched it).
  const [capitalTouched, setCapitalTouched] = useState(false);
  useEffect(() => {
    if (!capitalTouched) {
      setInputs((prev) => ({
        ...prev,
        startingCapital: Math.max(0, Math.round(currentNetWorth)),
      }));
    }
  }, [currentNetWorth, capitalTouched]);

  const out = useMemo(
    () => computeWhatIf(baseScenario, inputs, categories),
    [baseScenario, inputs, categories]
  );

  function reset() {
    setInputs({ ...INITIAL, startingCapital: Math.max(0, Math.round(currentNetWorth)) });
    setCapitalTouched(false);
  }

  if (transactions.length === 0) return <EmptyState />;

  const dirty =
    inputs.incomeMul !== 1 ||
    inputs.expenseMul !== 1 ||
    inputs.extraMonthlySave !== 0 ||
    Object.values(inputs.categoryMul || {}).some((v) => v !== 1);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FlaskConical className="w-6 h-6 text-accent" />
            Что-если — сценарии
          </h1>
          <p className="text-muted text-sm mt-1">
            Покрутите слайдеры — увидите, как изменится норма сбережений, срок до
            FIRE и капитал через 1/5/10 лет.
          </p>
        </div>
        {dirty && (
          <button onClick={reset} className="btn-ghost text-xs">
            <RotateCcw className="w-3.5 h-3.5" />
            Сбросить
          </button>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Inputs */}
        <div className="card card-pad space-y-5">
          <div>
            <div className="font-semibold mb-3 flex items-center gap-2">
              <Coins className="w-4 h-4 text-accent" />
              Основные параметры
            </div>
            <Slider
              label="Изменение дохода"
              value={inputs.incomeMul}
              min={0.5}
              max={2.0}
              step={0.05}
              format={(v) => `${v >= 1 ? "+" : ""}${formatPct(v - 1, 0)}`}
              hint={`Текущий: ${formatMoney(baseScenario.avgIncome, base, { compact: true })}/мес → ${formatMoney(out.newIncome, base, { compact: true })}/мес`}
              onChange={(v) => setInputs((prev) => ({ ...prev, incomeMul: v }))}
            />
            <Slider
              label="Изменение расхода"
              value={inputs.expenseMul}
              min={0.5}
              max={1.5}
              step={0.05}
              format={(v) => `${v >= 1 ? "+" : ""}${formatPct(v - 1, 0)}`}
              hint={`Текущий: ${formatMoney(baseScenario.avgExpense, base, { compact: true })}/мес → ${formatMoney(out.newExpense, base, { compact: true })}/мес`}
              onChange={(v) => setInputs((prev) => ({ ...prev, expenseMul: v }))}
            />
            <Slider
              label="Дополнительно отложить в месяц"
              value={inputs.extraMonthlySave}
              min={0}
              max={Math.max(50000, baseScenario.avgIncome * 0.5)}
              step={500}
              format={(v) => `+${formatMoney(v, base, { compact: true })}`}
              hint="Фиксированная сумма поверх нынешнего баланса доход−расход"
              onChange={(v) => setInputs((prev) => ({ ...prev, extraMonthlySave: v }))}
            />
            <div className="mt-3">
              <label className="label block mb-1">Стартовый капитал</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="1000"
                  value={inputs.startingCapital}
                  onChange={(e) => {
                    setCapitalTouched(true);
                    setInputs((prev) => ({
                      ...prev,
                      startingCapital: Number(e.target.value) || 0,
                    }));
                  }}
                  className="input text-sm flex-1"
                />
                <span className="text-xs text-muted">{base}</span>
              </div>
              <div className="text-[11px] text-muted mt-1">
                По умолчанию — текущий совокупный баланс (
                {formatMoney(currentNetWorth, base, { compact: true })}).
              </div>
            </div>
          </div>

          {categories.length > 0 && (
            <div>
              <div className="font-semibold mb-3 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-accent" />
                Категории расходов (топ-{categories.length})
              </div>
              <div className="space-y-3">
                {categories.map((c) => {
                  const mul = inputs.categoryMul?.[c.category] ?? 1;
                  return (
                    <Slider
                      key={c.category}
                      label={c.category}
                      value={mul}
                      min={0}
                      max={2}
                      step={0.05}
                      format={(v) => (v === 0 ? "−100%" : `${v >= 1 ? "+" : ""}${formatPct(v - 1, 0)}`)}
                      hint={`Сейчас ${formatMoney(c.monthly, base, { compact: true })}/мес → ${formatMoney(c.monthly * mul, base, { compact: true })}/мес`}
                      onChange={(v) =>
                        setInputs((prev) => ({
                          ...prev,
                          categoryMul: { ...prev.categoryMul, [c.category]: v },
                        }))
                      }
                    />
                  );
                })}
              </div>
              <div className="text-[11px] text-muted mt-2">
                Категории применяются ПЕРЕД общим множителем расхода.
              </div>
            </div>
          )}
        </div>

        {/* Outputs */}
        <div className="space-y-4">
          {/* Compare scenarios */}
          <div className="card card-pad">
            <div className="font-semibold mb-3">Сравнение</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="text-left font-normal">Метрика</th>
                  <th className="text-right font-normal">Сейчас</th>
                  <th className="text-right font-normal">Если так</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-t border-border">
                  <td className="py-2">Доход / мес</td>
                  <td className="py-2 text-right">
                    {formatMoney(baseScenario.avgIncome, base, { compact: true })}
                  </td>
                  <td className="py-2 text-right">
                    {formatMoney(out.newIncome, base, { compact: true })}
                  </td>
                </tr>
                <tr className="border-t border-border">
                  <td className="py-2">Расход / мес</td>
                  <td className="py-2 text-right">
                    {formatMoney(baseScenario.avgExpense, base, { compact: true })}
                  </td>
                  <td className="py-2 text-right">
                    {formatMoney(out.newExpense, base, { compact: true })}
                  </td>
                </tr>
                <tr className="border-t border-border">
                  <td className="py-2">Сбережения / мес</td>
                  <td className="py-2 text-right">
                    {formatMoney(baseScenario.avgSavings, base, { compact: true })}
                  </td>
                  <td
                    className={`py-2 text-right font-semibold ${out.newSavings > baseScenario.avgSavings ? "text-income" : out.newSavings < baseScenario.avgSavings ? "text-expense" : ""}`}
                  >
                    {formatMoney(out.newSavings, base, { compact: true })}
                  </td>
                </tr>
                <tr className="border-t border-border">
                  <td className="py-2">Норма сбережений</td>
                  <td className="py-2 text-right">
                    {formatPct(baseScenario.savingsRate, 0)}
                  </td>
                  <td className="py-2 text-right font-semibold">
                    {formatPct(out.newRate, 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* FIRE */}
          <div className="card card-pad">
            <div className="flex items-center gap-2 font-semibold mb-3">
              <Flame className="w-4 h-4 text-warn" />
              FIRE
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="label">Лет до FIRE сейчас</div>
                <div className="stat-num">{years(baseScenario.yearsToFireBase)}</div>
              </div>
              <div>
                <div className="label">При этом сценарии</div>
                <div
                  className={`stat-num ${out.yearsToFire < baseScenario.yearsToFireBase ? "text-income" : out.yearsToFire > baseScenario.yearsToFireBase ? "text-expense" : ""}`}
                >
                  {years(out.yearsToFire)}
                </div>
              </div>
            </div>
            {Math.abs(out.yearsSavedOnFire) > 0.1 && Number.isFinite(out.yearsSavedOnFire) && (
              <div className="mt-3 text-sm">
                {out.yearsSavedOnFire > 0 ? (
                  <span className="text-income">
                    Сэкономлено {out.yearsSavedOnFire.toFixed(1)} лет до финансовой
                    свободы
                  </span>
                ) : (
                  <span className="text-expense">
                    Срок отодвинется на {Math.abs(out.yearsSavedOnFire).toFixed(1)} лет
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Projected capital */}
          <div className="card card-pad">
            <div className="flex items-center gap-2 font-semibold mb-3">
              <PiggyBank className="w-4 h-4 text-accent2" />
              Прогноз капитала
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="через 1 год" value={out.projected1y} base={base} />
              <Stat label="через 5 лет" value={out.projected5y} base={base} />
              <Stat label="через 10 лет" value={out.projected10y} base={base} />
            </div>
            <div className="text-[11px] text-muted mt-3">
              Линейный прогноз без учёта доходности инвестиций. Реальные суммы при
              разумной доходности будут больше за счёт сложного процента.
            </div>
          </div>

          {/* Annual delta */}
          {Math.abs(out.annualSavingsDelta) > 100 && (
            <div className="card card-pad bg-accent/5 border-accent/40">
              <div className="flex items-center gap-2 text-sm">
                {out.annualSavingsDelta > 0 ? (
                  <TrendingUp className="w-4 h-4 text-income shrink-0" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-expense shrink-0" />
                )}
                <span>
                  За год это{" "}
                  <strong
                    className={out.annualSavingsDelta > 0 ? "text-income" : "text-expense"}
                  >
                    {out.annualSavingsDelta > 0 ? "+" : ""}
                    {formatMoney(out.annualSavingsDelta, base, { compact: true })}
                  </strong>{" "}
                  к текущей траектории.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-accent">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

function Stat({ label, value, base }: { label: string; value: number; base: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="stat-num text-base">{formatMoney(value, base, { compact: true })}</div>
    </div>
  );
}
