import type { Transaction } from "../types";
import {
  groupByMonth,
  netWorthSeries,
  splitByObligation,
  detectUncategorized,
  type CalibrationInput,
  type ObligationMeta,
} from "./aggregations";

export type HealthStatus = "good" | "fair" | "poor" | "na";

export interface HealthComponent {
  id: string;
  label: string;
  weight: number;     // raw weight (used to normalise when one component is N/A)
  score: number;     // 0–100 (or 0 if status is "na")
  value: number | null; // raw metric (savings rate, coverage months, %, etc.)
  status: HealthStatus;
  detail: string;    // what is measured, plain-language
  hint: string;      // advice when score is poor / fair
  /** Optional secondary, purely informational figure shown under the card —
   *  does NOT affect the score. Used by «Подушка безопасности» to also show
   *  the runway on OBLIGATORY-only spending (issue #32). */
  extra?: { label: string; value: string; hint?: string };
}

export interface HealthScore {
  overall: number;       // 0–100, weighted across components with status !== "na"
  grade: string;         // A+ / A / B / C / D / E
  components: HealthComponent[];
  baseCurrency: string;
}

interface ComputeOptions {
  transactions: Transaction[];
  baseCurrency: string;
  calibration: CalibrationInput | null;
  /** Category meta (title / full-path → { required }) — drives the
   *  obligatory/optional split per transaction, subcategory-aware (#5). */
  categoryMeta: ObligationMeta;
  /** Off-balance accounts' total (base currency) to add to the emergency fund —
   *  savings kept off-balance ARE the cushion. Pass the sum NOT already counted
   *  by the net-worth calibration (i.e. when «include off-balance» is off). */
  extraLiquid?: number;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

function classify(score: number): HealthStatus {
  if (score >= 75) return "good";
  if (score >= 50) return "fair";
  return "poor";
}

function gradeFor(overall: number): string {
  if (overall >= 90) return "A+";
  if (overall >= 80) return "A";
  if (overall >= 70) return "B";
  if (overall >= 60) return "C";
  if (overall >= 50) return "D";
  return "E";
}

// ─── individual components ────────────────────────────────────────────────────

function computeSavingsRate(opts: ComputeOptions): HealthComponent {
  const months = groupByMonth(opts.transactions);
  const recent = months.slice(-6);
  const avgIncome = mean(recent.map((m) => m.income));
  const avgExpense = mean(recent.map((m) => m.expense));
  const rate = avgIncome > 0 ? (avgIncome - avgExpense) / avgIncome : 0;

  // Target 20%. Score: 0% → 0, 20% → 100, clamp.
  const score = clamp((rate / 0.2) * 100);

  return {
    id: "savings_rate",
    label: "Норма сбережений",
    weight: 30,
    score,
    value: rate,
    status: recent.length === 0 ? "na" : classify(score),
    detail: "Среднее за последние 6 месяцев: (доход − расход) / доход.",
    hint:
      rate < 0.1
        ? "Целитесь в 20%. Начните с урезания дискретных категорий или подписок."
        : rate < 0.2
          ? "Чуть-чуть до цели в 20%. Проверьте топ категорий — где можно сэкономить."
          : "",
  };
}

function computeEmergencyFund(opts: ComputeOptions): HealthComponent {
  const series = netWorthSeries(opts.transactions, opts.calibration);
  const netWorth = series.length > 0 ? series[series.length - 1].net : 0;
  // Off-balance savings count toward the cushion even when they're excluded
  // from the headline net worth.
  const liquid = netWorth + (opts.extraLiquid ?? 0);
  const months = groupByMonth(opts.transactions);
  const recent = months.slice(-6);
  const avgExpense = mean(recent.map((m) => m.expense));
  const coverage = avgExpense > 0 ? liquid / avgExpense : 0;

  // Runway on OBLIGATORY spending over the last 12 months (issue #32). In a
  // real emergency the discretionary spend is the first thing cut, so the
  // savings actually last longer than the all-expenses figure suggests — this
  // «worst-case survival» number divides the same liquid cushion by the
  // average MONTHLY obligatory expense across up to 12 recent months.
  const last12 = months.slice(-12);
  const last12Set = new Set(last12.map((m) => m.ym));
  const last12Txs = opts.transactions.filter((t) =>
    last12Set.has(t.date.slice(0, 7))
  );
  const obligatory12 = splitByObligation(last12Txs, opts.categoryMeta).obligatory;
  const avgMonthlyObligatory =
    last12.length > 0 ? obligatory12 / last12.length : 0;
  const obligatoryCoverage =
    avgMonthlyObligatory > 0 ? liquid / avgMonthlyObligatory : 0;

  // Target: 6 months. Score: 0 → 0, 6 → 100, clamp.
  const score = clamp((coverage / 6) * 100);

  return {
    id: "emergency_fund",
    label: "Подушка безопасности",
    weight: 25,
    score,
    value: coverage,
    status: avgExpense <= 0 ? "na" : classify(score),
    detail:
      "Сколько месяцев средних расходов покрывает текущий баланс — включая забалансовые накопительные счета.",
    extra:
      avgMonthlyObligatory > 0
        ? {
            label: "Хватит по обязательным тратам",
            value: `${obligatoryCoverage.toFixed(1)} мес`,
            hint: "Если в кризис урезать всё необязательное — на сколько месяцев хватит накоплений при средних обязательных расходах за последние 12 месяцев.",
          }
        : undefined,
    hint:
      coverage < 1
        ? "Меньше месяца! Это критично — отложите подушку как первоочередную цель."
        : coverage < 3
          ? "Цельтесь хотя бы в 3 месяца. Полная подушка — 6 месяцев расходов."
          : coverage < 6
            ? "Уже неплохо. Добейте до 6 месяцев, чтобы спокойно пережить любое."
            : "",
  };
}

function computeUncategorized(opts: ComputeOptions): HealthComponent {
  const total = opts.transactions.filter((t) => t.kind !== "transfer").length;
  const uncategorized = detectUncategorized(opts.transactions).length;
  const pct = total > 0 ? uncategorized / total : 0;

  // Target: < 5%. Score: 0% → 100, 10% → 0.
  const score = clamp(100 - pct * 1000);

  return {
    id: "uncategorized",
    label: "Чистота категоризации",
    weight: 15,
    score,
    value: pct,
    status: total === 0 ? "na" : classify(score),
    detail: "Процент операций без категории.",
    hint:
      pct > 0.1
        ? "Много операций без категории — аналитика искажена. Загляните на страницу «Без категории» — там есть smart suggestions, которые создают правила одним кликом."
        : pct > 0.05
          ? "Можно почистить ещё немного. Загляните на страницу «Без категории»."
          : "",
  };
}

function computeStability(opts: ComputeOptions): HealthComponent {
  const months = groupByMonth(opts.transactions);
  const recent = months.slice(-12);
  if (recent.length < 3) {
    return {
      id: "stability",
      label: "Стабильность сбережений",
      weight: 15,
      score: 0,
      value: null,
      status: "na",
      detail:
        "Коэффициент вариации помесячной нормы сбережений за 12 месяцев. Чем стабильнее — тем лучше.",
      hint: "Нужно минимум 3 месяца данных, чтобы оценить.",
    };
  }
  const rates = recent
    .filter((m) => m.income > 0)
    .map((m) => (m.income - m.expense) / m.income);
  if (rates.length < 3) {
    return {
      id: "stability",
      label: "Стабильность сбережений",
      weight: 15,
      score: 0,
      value: null,
      status: "na",
      detail:
        "Коэффициент вариации помесячной нормы сбережений за 12 месяцев. Чем стабильнее — тем лучше.",
      hint: "Нужно минимум 3 месяца с положительным доходом, чтобы оценить.",
    };
  }
  const m = mean(rates);
  const sd = stddev(rates);
  // CV = sd / |mean|. Если mean маленький — CV неустойчив, поэтому защитимся.
  const cv = Math.abs(m) > 0.01 ? sd / Math.abs(m) : sd / 0.01;
  // Target CV ≤ 0.5. Score: CV 0 → 100, CV 1 → 0.
  const score = clamp(100 - cv * 100);

  return {
    id: "stability",
    label: "Стабильность сбережений",
    weight: 15,
    score,
    value: cv,
    status: classify(score),
    detail:
      "Насколько ровно вы откладываете из месяца в месяц. Высокий CV → один месяц густо, другой пусто.",
    hint:
      cv > 1
        ? "Скачки очень большие. Попробуйте автоматизировать переводы на накопления в начале месяца."
        : cv > 0.5
          ? "Сбережения скачут — может, пора зафиксировать постоянную сумму, которую вы откладываете каждый месяц независимо от настроения."
          : "",
  };
}

function computeFixedLoad(opts: ComputeOptions): HealthComponent {
  const months = groupByMonth(opts.transactions);
  const recent = months.slice(-6);
  const avgIncome = mean(recent.map((m) => m.income));

  // Берём расходы последних 6 месяцев и считаем долю обязательных.
  const recentSet = new Set(recent.map((r) => r.ym));
  const recentTxs = opts.transactions.filter((t) =>
    recentSet.has(t.date.slice(0, 7))
  );
  const split = splitByObligation(recentTxs, opts.categoryMeta);
  const monthlyObligatory =
    recent.length > 0 ? split.obligatory / recent.length : 0;
  const share = avgIncome > 0 ? monthlyObligatory / avgIncome : 0;

  // Target ≤ 50%. Score: 30% → 100, 80% → 0.
  const score = clamp(100 - (share - 0.3) * 200);

  return {
    id: "fixed_load",
    label: "Доля обязательных в доходе",
    weight: 15,
    score,
    value: share,
    status: avgIncome <= 0 ? "na" : classify(score),
    detail:
      "Какую часть дохода съедают обязательные траты (квартира, машина, продукты, и т.п.). Чем меньше — тем больше «свободных денег» остаётся на цели и резервы. Категории помечаются как обязательные/необязательные в редакторе «Обязательность доходов и расходов» на странице «Категории».",
    hint:
      share > 0.8
        ? "Обязательные траты съедают почти весь доход — почти нет манёвра. Если возможно, пересмотрите крупные обязательства (рефинансирование, переезд, отказ от подписок)."
        : share > 0.5
          ? "Половина дохода уходит на обязательное. Не критично, но любая нештатная ситуация может ударить."
          : "",
  };
}

// ─── public API ───────────────────────────────────────────────────────────────

export function computeHealthScore(opts: ComputeOptions): HealthScore {
  const components: HealthComponent[] = [
    computeSavingsRate(opts),
    computeEmergencyFund(opts),
    computeUncategorized(opts),
    computeStability(opts),
    computeFixedLoad(opts),
  ];

  // Weighted average over components with non-NA status.
  const active = components.filter((c) => c.status !== "na");
  const totalWeight = active.reduce((s, c) => s + c.weight, 0);
  const overall =
    totalWeight > 0
      ? Math.round(active.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight)
      : 0;

  return {
    overall,
    grade: gradeFor(overall),
    components,
    baseCurrency: opts.baseCurrency,
  };
}
