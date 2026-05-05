import type { Transaction } from "../types";
import { ymKey, ymdKey } from "./format";

export interface MonthBucket {
  ym: string;
  income: number;
  expense: number;
  net: number;
  count: number;
}

export function groupByMonth(txs: Transaction[]): MonthBucket[] {
  const map = new Map<string, MonthBucket>();
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    const ym = ymKey(t.date);
    if (!ym) continue;
    let b = map.get(ym);
    if (!b) {
      b = { ym, income: 0, expense: 0, net: 0, count: 0 };
      map.set(ym, b);
    }
    if (t.kind === "income") b.income += t.amountBase;
    else b.expense += t.amountBase;
    b.count++;
  }
  for (const b of map.values()) b.net = b.income - b.expense;
  return Array.from(map.values()).sort((a, b) => a.ym.localeCompare(b.ym));
}

export interface CategoryBucket {
  category: string;
  expense: number;
  income: number;
  net: number;
  count: number;
}

export function groupByCategory(
  txs: Transaction[],
  level: "top" | "full" = "top"
): CategoryBucket[] {
  const map = new Map<string, CategoryBucket>();
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    const key = level === "top" ? t.category : t.categoryFull;
    let b = map.get(key);
    if (!b) {
      b = { category: key, expense: 0, income: 0, net: 0, count: 0 };
      map.set(key, b);
    }
    if (t.kind === "income") b.income += t.amountBase;
    else b.expense += t.amountBase;
    b.count++;
  }
  for (const b of map.values()) b.net = b.income - b.expense;
  return Array.from(map.values()).sort((a, b) => b.expense - a.expense);
}

export interface AccountBalance {
  account: string;
  balance: number;
  income: number;
  expense: number;
  count: number;
}

export function balancesByAccount(txs: Transaction[]): AccountBalance[] {
  const map = new Map<string, AccountBalance>();
  for (const t of txs) {
    const accs: { acc: string; delta: number }[] = [];
    if (t.kind === "expense") accs.push({ acc: t.outcomeAccount, delta: -t.amountBase });
    else if (t.kind === "income") accs.push({ acc: t.incomeAccount, delta: t.amountBase });
    else if (t.kind === "transfer") {
      accs.push({ acc: t.outcomeAccount, delta: -t.amountBase });
      accs.push({ acc: t.incomeAccount, delta: t.amountBase });
    }
    for (const { acc, delta } of accs) {
      if (!acc) continue;
      let b = map.get(acc);
      if (!b) {
        b = { account: acc, balance: 0, income: 0, expense: 0, count: 0 };
        map.set(acc, b);
      }
      b.balance += delta;
      if (delta > 0) b.income += delta;
      else b.expense += -delta;
      b.count++;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.balance - a.balance);
}

export interface DailyPoint {
  date: string;
  balance: number;
  delta: number;
}

export function dailyBalanceSeries(
  txs: Transaction[],
  account?: string
): DailyPoint[] {
  const days = new Map<string, number>();
  for (const t of txs) {
    const d = ymdKey(t.date);
    if (!d) continue;
    let delta = 0;
    if (account) {
      if (t.outcomeAccount === account && (t.kind === "expense" || t.kind === "transfer")) delta -= t.amountBase;
      if (t.incomeAccount === account && (t.kind === "income" || t.kind === "transfer")) delta += t.amountBase;
    } else {
      if (t.kind === "income") delta += t.amountBase;
      else if (t.kind === "expense") delta -= t.amountBase;
    }
    if (delta !== 0) days.set(d, (days.get(d) || 0) + delta);
  }
  const sorted = Array.from(days.keys()).sort();
  let bal = 0;
  return sorted.map((d) => {
    bal += days.get(d)!;
    return { date: d, balance: bal, delta: days.get(d)! };
  });
}

export interface StackedBalancePoint {
  date: string;
  total: number;
  [account: string]: number | string;
}

export function stackedBalanceByAccount(
  allTxs: Transaction[],
  topN = 8
): { series: StackedBalancePoint[]; accounts: string[] } {
  const balances = balancesByAccount(allTxs);
  const topAccounts = balances
    .slice()
    .sort((a, b) => Math.abs(b.balance) + b.income + b.expense - (Math.abs(a.balance) + a.income + a.expense))
    .slice(0, topN)
    .map((b) => b.account);
  const accountSet = new Set(topAccounts);

  const days = new Map<string, Map<string, number>>();
  for (const t of allTxs) {
    const d = ymdKey(t.date);
    if (!d) continue;
    const apply = (acc: string, delta: number) => {
      if (!acc) return;
      const key = accountSet.has(acc) ? acc : "Прочие";
      let dayMap = days.get(d);
      if (!dayMap) {
        dayMap = new Map();
        days.set(d, dayMap);
      }
      dayMap.set(key, (dayMap.get(key) || 0) + delta);
    };
    if (t.kind === "expense") apply(t.outcomeAccount, -t.amountBase);
    else if (t.kind === "income") apply(t.incomeAccount, t.amountBase);
    else if (t.kind === "transfer") {
      apply(t.outcomeAccount, -t.amountBase);
      apply(t.incomeAccount, t.amountBase);
    }
  }

  const accountList = [...topAccounts];
  const hasOther = Array.from(days.values()).some((m) => m.has("Прочие"));
  if (hasOther) accountList.push("Прочие");

  const sortedDates = Array.from(days.keys()).sort();
  const running: Record<string, number> = {};
  for (const a of accountList) running[a] = 0;

  const series: StackedBalancePoint[] = [];
  for (const date of sortedDates) {
    const dayMap = days.get(date)!;
    for (const a of accountList) {
      running[a] += dayMap.get(a) || 0;
    }
    const point: StackedBalancePoint = { date, total: 0 };
    let total = 0;
    for (const a of accountList) {
      point[a] = Math.round(running[a]);
      total += running[a];
    }
    point.total = Math.round(total);
    series.push(point);
  }
  return { series, accounts: accountList };
}

export interface CalibrationInput {
  date: string;
  amount: number;
}

// ============= Waterfall =============

export interface WaterfallStep {
  label: string;
  value: number;
  cumulative: number;
  kind: "open" | "income" | "expense" | "close";
  start: number;
  end: number;
}

export function buildWaterfall(
  txs: Transaction[],
  monthYM: string,
  openingBalance: number,
  topCategories = 8
): WaterfallStep[] {
  const monthTxs = txs.filter((t) => t.date.startsWith(monthYM));

  let totalIncome = 0;
  const expenseByCategory = new Map<string, number>();
  for (const t of monthTxs) {
    if (t.kind === "income") totalIncome += t.amountBase;
    else if (t.kind === "expense") {
      expenseByCategory.set(
        t.category,
        (expenseByCategory.get(t.category) || 0) + t.amountBase
      );
    }
  }

  const sortedCats = Array.from(expenseByCategory.entries()).sort(
    (a, b) => b[1] - a[1]
  );
  const top = sortedCats.slice(0, topCategories);
  const otherSum = sortedCats.slice(topCategories).reduce((s, [, v]) => s + v, 0);

  const steps: WaterfallStep[] = [];
  let cumulative = openingBalance;

  steps.push({
    label: "Начало",
    value: openingBalance,
    cumulative,
    kind: "open",
    start: 0,
    end: cumulative,
  });

  if (totalIncome > 0) {
    const start = cumulative;
    cumulative += totalIncome;
    steps.push({
      label: "Доходы",
      value: totalIncome,
      cumulative,
      kind: "income",
      start,
      end: cumulative,
    });
  }

  for (const [cat, value] of top) {
    const start = cumulative;
    cumulative -= value;
    steps.push({
      label: cat,
      value,
      cumulative,
      kind: "expense",
      start: cumulative,
      end: start,
    });
  }

  if (otherSum > 0) {
    const start = cumulative;
    cumulative -= otherSum;
    steps.push({
      label: "Прочие",
      value: otherSum,
      cumulative,
      kind: "expense",
      start: cumulative,
      end: start,
    });
  }

  steps.push({
    label: "Конец",
    value: cumulative,
    cumulative,
    kind: "close",
    start: 0,
    end: cumulative,
  });

  return steps;
}

// ============= Stream graph data =============

export interface StreamPoint {
  ym: string;
  label: string;
  [category: string]: number | string;
}

export function buildStreamData(
  txs: Transaction[],
  topCategories = 10,
  kind: "expense" | "income" = "expense"
): { data: StreamPoint[]; categories: string[] } {
  const monthsSet = new Set<string>();
  const totals = new Map<string, number>();
  const byMonthCat = new Map<string, Map<string, number>>();

  for (const t of txs) {
    if (t.kind !== kind) continue;
    const ym = t.date.slice(0, 7);
    if (!ym) continue;
    monthsSet.add(ym);
    totals.set(t.category, (totals.get(t.category) || 0) + t.amountBase);
    let m = byMonthCat.get(ym);
    if (!m) {
      m = new Map();
      byMonthCat.set(ym, m);
    }
    m.set(t.category, (m.get(t.category) || 0) + t.amountBase);
  }

  const topCats = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topCategories)
    .map(([k]) => k);
  const topSet = new Set(topCats);

  const months = Array.from(monthsSet).sort();
  const data: StreamPoint[] = months.map((ym) => {
    const m = byMonthCat.get(ym) || new Map();
    const point: StreamPoint = { ym, label: ym };
    for (const cat of topCats) point[cat] = Math.round(m.get(cat) || 0);
    let other = 0;
    for (const [cat, v] of m) if (!topSet.has(cat)) other += v;
    point["Прочие"] = Math.round(other);
    return point;
  });

  return { data, categories: [...topCats, "Прочие"] };
}

// ============= Seasonality =============

export interface SeasonalityPoint {
  monthIdx: number;
  monthName: string;
  avgExpense: number;
  avgIncome: number;
  yearsSampled: number;
  expenseDeviationPct: number;
}

const SEASON_MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export function detectSeasonality(txs: Transaction[]): SeasonalityPoint[] {
  const monthly = new Map<string, { income: number; expense: number }>();
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    const ym = t.date.slice(0, 7);
    if (!ym) continue;
    let m = monthly.get(ym);
    if (!m) {
      m = { income: 0, expense: 0 };
      monthly.set(ym, m);
    }
    if (t.kind === "income") m.income += t.amountBase;
    else m.expense += t.amountBase;
  }

  const byMonth: { income: number[]; expense: number[] }[] = Array.from(
    { length: 12 },
    () => ({ income: [], expense: [] })
  );

  for (const [ym, vals] of monthly) {
    const m = Number(ym.slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    byMonth[m].income.push(vals.income);
    byMonth[m].expense.push(vals.expense);
  }

  const overallAvgExpense =
    Array.from(monthly.values()).reduce((s, m) => s + m.expense, 0) /
    Math.max(monthly.size, 1);

  return byMonth.map((b, i) => {
    const avgExpense =
      b.expense.length > 0
        ? b.expense.reduce((s, v) => s + v, 0) / b.expense.length
        : 0;
    const avgIncome =
      b.income.length > 0
        ? b.income.reduce((s, v) => s + v, 0) / b.income.length
        : 0;
    const dev =
      overallAvgExpense > 0
        ? (avgExpense - overallAvgExpense) / overallAvgExpense
        : 0;
    return {
      monthIdx: i,
      monthName: SEASON_MONTH_NAMES[i],
      avgExpense,
      avgIncome,
      yearsSampled: b.expense.length,
      expenseDeviationPct: dev,
    };
  });
}

// ============= Word cloud =============

const RU_STOPWORDS = new Set([
  "и","в","на","с","по","для","к","от","за","до","из","о","но","а","что","это","как","или","же","бы","ли","не","ни","во","со","ко","во","со","о","у","во","над","под","при","между","через","также","ещё","еще","там","тут","где","куда","сюда","туда","когда","тогда","сейчас","потом","уже","вот","есть","будет","был","была","было","были","быть","буду","будут","можно","нужно","надо","даже","или","если","потому","чтобы","того","этой","этом","эта","этот","эти","всё","все","всех","весь","вся","моя","моё","наш","наша","ваш","ваша","его","её","их","чей","меня","мне","мы","нам","нас","ты","вы","вас","вам","я","он","она","оно","они","них","ним","ему","ей","ей","им","ими","себя","сам","сама",
  "the","a","an","of","to","in","on","for","with","at","by","from","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","can","could","should","may","might","must","this","that","these","those","it","its","i","my","you","your","he","she","they","we",
  "руб","р","₽","шт","ст","оп","нет","да","все","всё",
]);

export interface WordcloudWord {
  text: string;
  count: number;
  totalAmount: number;
  txIds: string[];
}

export function buildWordcloud(
  txs: Transaction[],
  minLength = 3,
  topN = 100
): WordcloudWord[] {
  const map = new Map<string, WordcloudWord>();

  for (const t of txs) {
    if (t.kind === "transfer") continue;
    if (!t.comment) continue;
    const seen = new Set<string>();
    const tokens = t.comment
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s#-]+/gu, " ")
      .split(/\s+/)
      .filter(Boolean);
    for (const raw of tokens) {
      const w = raw.replace(/^[#-]+|[#-]+$/g, "");
      if (w.length < minLength) continue;
      if (RU_STOPWORDS.has(w)) continue;
      if (/^\d+$/.test(w)) continue;
      if (seen.has(w)) continue;
      seen.add(w);
      let entry = map.get(w);
      if (!entry) {
        entry = { text: w, count: 0, totalAmount: 0, txIds: [] };
        map.set(w, entry);
      }
      entry.count++;
      entry.totalAmount += t.amountBase;
      if (entry.txIds.length < 200) entry.txIds.push(t.id);
    }
  }

  return Array.from(map.values())
    .filter((w) => w.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

// ============= Smart category suggestions =============

export interface CategorySuggestion {
  txId: string;
  payee: string;
  comment: string;
  amount: number;
  currency: string;
  date: string;
  suggested: string;
  confidence: number;
  reasonExamples: string[];
}

function tokenize(text: string): Set<string> {
  return new Set(
    (text || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !RU_STOPWORDS.has(w) && !/^\d+$/.test(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function suggestCategoriesForUncategorized(
  txs: Transaction[],
  uncategorized: Transaction[],
  k = 5
): CategorySuggestion[] {
  const corpus = txs
    .filter((t) => {
      if (t.kind === "transfer") return false;
      const cat = t.categoryFull || "";
      if (!cat) return false;
      if (/^\s*$/.test(cat)) return false;
      if (/^прочи|без катего|other|misc/i.test(cat)) return false;
      return true;
    })
    .map((t) => ({
      tx: t,
      tokens: tokenize(`${t.payee} ${t.comment} ${t.categoryFull}`),
      payee: (t.payee || "").toLowerCase(),
    }));

  const suggestions: CategorySuggestion[] = [];

  for (const u of uncategorized) {
    const uTokens = tokenize(`${u.payee} ${u.comment}`);
    const uPayee = (u.payee || "").toLowerCase();

    const scored = corpus
      .map((c) => {
        const sim = jaccard(uTokens, c.tokens);
        const payeeBoost =
          uPayee && c.payee && (uPayee === c.payee || c.payee.includes(uPayee) || uPayee.includes(c.payee))
            ? 0.5
            : 0;
        return { tx: c.tx, score: sim + payeeBoost };
      })
      .filter((x) => x.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    if (scored.length === 0) continue;

    const votes = new Map<string, { score: number; examples: string[] }>();
    for (const s of scored) {
      const cat = s.tx.categoryFull;
      let v = votes.get(cat);
      if (!v) {
        v = { score: 0, examples: [] };
        votes.set(cat, v);
      }
      v.score += s.score;
      if (v.examples.length < 3 && s.tx.payee) v.examples.push(s.tx.payee);
    }
    const winner = Array.from(votes.entries()).sort(
      (a, b) => b[1].score - a[1].score
    )[0];
    if (!winner) continue;

    const totalScore = scored.reduce((s, x) => s + x.score, 0);
    const conf = totalScore > 0 ? winner[1].score / totalScore : 0;

    suggestions.push({
      txId: u.id,
      payee: u.payee,
      comment: u.comment,
      amount: u.amount,
      currency: u.currency,
      date: u.date,
      suggested: winner[0],
      confidence: conf,
      reasonExamples: winner[1].examples,
    });
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

export interface DuplicateGroup {
  signature: string;
  txs: Transaction[];
  totalAmount: number;
}

export function detectDuplicates(txs: Transaction[], windowDays = 3): DuplicateGroup[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    const sig = `${t.kind}|${t.payee || "?"}|${Math.round(t.amount)}|${t.currency}`;
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig)!.push(t);
  }
  const out: DuplicateGroup[] = [];
  for (const [sig, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const cluster: Transaction[] = [list[0]];
    for (let i = 1; i < list.length; i++) {
      const days =
        (+new Date(list[i].date) - +new Date(cluster[cluster.length - 1].date)) /
        86400000;
      if (days <= windowDays) {
        cluster.push(list[i]);
      } else {
        if (cluster.length >= 2) {
          out.push({
            signature: sig,
            txs: [...cluster],
            totalAmount: cluster.reduce((s, x) => s + x.amountBase, 0),
          });
        }
        cluster.length = 0;
        cluster.push(list[i]);
      }
    }
    if (cluster.length >= 2) {
      out.push({
        signature: sig,
        txs: [...cluster],
        totalAmount: cluster.reduce((s, x) => s + x.amountBase, 0),
      });
    }
  }
  return out.sort((a, b) => b.totalAmount - a.totalAmount);
}

export function detectUncategorized(txs: Transaction[]): Transaction[] {
  const empty = /^\s*$/;
  const generic = /^(прочи|без катего|other|misc)/i;
  return txs.filter((t) => {
    if (t.kind === "transfer") return false;
    if (empty.test(t.category) || generic.test(t.category)) return true;
    return false;
  });
}

export interface ScenarioForecast {
  ym: string;
  income: number;
  expense: number;
  optimistic: number;
  realistic: number;
  pessimistic: number;
  isForecast: boolean;
}

export function buildScenarioForecast(
  txs: Transaction[],
  monthsAhead = 6,
  lookback = 6
): ScenarioForecast[] {
  const months = groupByMonth(txs);
  if (months.length === 0) return [];
  const recent = months.slice(-lookback);
  const incomes = recent.map((m) => m.income);
  const expenses = recent.map((m) => m.expense);
  const meanI = incomes.reduce((s, v) => s + v, 0) / incomes.length;
  const meanE = expenses.reduce((s, v) => s + v, 0) / expenses.length;
  const stdI = Math.sqrt(
    incomes.reduce((s, v) => s + (v - meanI) ** 2, 0) / incomes.length
  );
  const stdE = Math.sqrt(
    expenses.reduce((s, v) => s + (v - meanE) ** 2, 0) / expenses.length
  );

  const out: ScenarioForecast[] = months.map((m) => ({
    ym: m.ym,
    income: m.income,
    expense: m.expense,
    optimistic: m.net,
    realistic: m.net,
    pessimistic: m.net,
    isForecast: false,
  }));

  const last = months[months.length - 1].ym;
  const [ly, lm] = last.split("-").map(Number);
  for (let i = 1; i <= monthsAhead; i++) {
    const d = new Date(ly, lm - 1 + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({
      ym,
      income: meanI,
      expense: meanE,
      optimistic: meanI + stdI - (meanE - stdE),
      realistic: meanI - meanE,
      pessimistic: meanI - stdI - (meanE + stdE),
      isForecast: true,
    });
  }
  return out;
}

export interface HourOfWeekCell {
  dow: number;
  hour: number;
  total: number;
  count: number;
}

export function statsByHourOfWeek(
  txs: Transaction[],
  kind: "expense" | "income" = "expense"
): HourOfWeekCell[] {
  const cells: HourOfWeekCell[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      cells.push({ dow: d, hour: h, total: 0, count: 0 });
    }
  }
  for (const t of txs) {
    if (t.kind !== kind) continue;
    const d = new Date(t.createdAt || t.date);
    const dow = d.getDay();
    const hour = d.getHours();
    const cell = cells[dow * 24 + hour];
    cell.total += t.amountBase;
    cell.count++;
  }
  return cells;
}

export function vsAverageStats(
  txs: Transaction[]
): { current: { ym: string; expense: number; income: number; net: number } | null; avg: { expense: number; income: number; net: number } } {
  const months = groupByMonth(txs);
  if (months.length === 0) {
    return { current: null, avg: { expense: 0, income: 0, net: 0 } };
  }
  const current = months[months.length - 1];
  const previous = months.slice(0, -1);
  if (previous.length === 0) {
    return {
      current: { ym: current.ym, expense: current.expense, income: current.income, net: current.net },
      avg: { expense: 0, income: 0, net: 0 },
    };
  }
  const avgE = previous.reduce((s, m) => s + m.expense, 0) / previous.length;
  const avgI = previous.reduce((s, m) => s + m.income, 0) / previous.length;
  return {
    current: { ym: current.ym, expense: current.expense, income: current.income, net: current.net },
    avg: { expense: avgE, income: avgI, net: avgI - avgE },
  };
}

export interface YoYPoint {
  monthIdx: number;
  monthName: string;
  thisYear: number | null;
  lastYear: number | null;
}

export function yearOverYearMonthly(
  txs: Transaction[],
  year: number,
  kind: "expense" | "income" = "expense"
): YoYPoint[] {
  const months = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
  const totals = new Map<string, number>();
  for (const t of txs) {
    if (t.kind !== kind) continue;
    const ym = t.date.slice(0, 7);
    totals.set(ym, (totals.get(ym) || 0) + t.amountBase);
  }
  const out: YoYPoint[] = [];
  for (let m = 0; m < 12; m++) {
    const thisKey = `${year}-${String(m + 1).padStart(2, "0")}`;
    const lastKey = `${year - 1}-${String(m + 1).padStart(2, "0")}`;
    out.push({
      monthIdx: m,
      monthName: months[m],
      thisYear: totals.has(thisKey) ? Math.round(totals.get(thisKey)!) : null,
      lastYear: totals.has(lastKey) ? Math.round(totals.get(lastKey)!) : null,
    });
  }
  return out;
}

export interface SankeyData {
  nodes: { name: string; kind?: "income" | "account" | "category" }[];
  links: { source: number; target: number; value: number }[];
}

export function buildSankey(txs: Transaction[]): SankeyData {
  const incomeCats = new Map<string, number>();
  const expenseCats = new Map<string, number>();
  let totalIncome = 0;
  let totalExpense = 0;
  for (const t of txs) {
    if (t.kind === "income") {
      const k = t.category || "Прочие доходы";
      incomeCats.set(k, (incomeCats.get(k) || 0) + t.amountBase);
      totalIncome += t.amountBase;
    } else if (t.kind === "expense") {
      const k = t.category || "Прочие";
      expenseCats.set(k, (expenseCats.get(k) || 0) + t.amountBase);
      totalExpense += t.amountBase;
    }
  }
  const incomeArr = Array.from(incomeCats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const expenseArr = Array.from(expenseCats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  const incomeOther = totalIncome - incomeArr.reduce((s, x) => s + x[1], 0);
  const expenseOther = totalExpense - expenseArr.reduce((s, x) => s + x[1], 0);

  const finalIncome = [...incomeArr];
  if (incomeOther > 0) finalIncome.push(["Прочие доходы", incomeOther]);
  const finalExpense = [...expenseArr];
  if (expenseOther > 0) finalExpense.push(["Прочие траты", expenseOther]);

  const nodes: { name: string; kind?: "income" | "account" | "category" }[] = [];
  const links: { source: number; target: number; value: number }[] = [];
  const POOL_NAME = "Бюджет";

  finalIncome.forEach(([name]) => nodes.push({ name: name as string, kind: "income" }));
  const poolIdx = nodes.length;
  nodes.push({ name: POOL_NAME, kind: "account" });
  finalExpense.forEach(([name]) => nodes.push({ name: name as string, kind: "category" }));

  finalIncome.forEach((entry, i) => {
    const v = Math.round(entry[1] as number);
    if (v > 0) links.push({ source: i, target: poolIdx, value: v });
  });
  finalExpense.forEach((entry, i) => {
    const v = Math.round(entry[1] as number);
    if (v > 0) links.push({ source: poolIdx, target: poolIdx + 1 + i, value: v });
  });

  return { nodes, links };
}

export interface CategoryFlagsData {
  fixed: number;
  discretionary: number;
  unflagged: number;
}

export function applyCategoryFlags(
  txs: Transaction[],
  fixedCategories: Set<string>,
  discretionaryCategories: Set<string>
): CategoryFlagsData {
  let fixed = 0;
  let discretionary = 0;
  let unflagged = 0;
  for (const t of txs) {
    if (t.kind !== "expense") continue;
    if (fixedCategories.has(t.category)) fixed += t.amountBase;
    else if (discretionaryCategories.has(t.category)) discretionary += t.amountBase;
    else unflagged += t.amountBase;
  }
  return { fixed, discretionary, unflagged };
}

const ANCHOR_PATTERNS = [
  /начальн[ыо]\s*остат/i,
  /корректировк/i,
  /initial\s*balance/i,
  /opening\s*balance/i,
  /balance\s*adjust/i,
  /starting\s*balance/i,
  /остат[ок]+\s+на\s+нач/i,
];

export interface BalanceAnchor {
  tx: Transaction;
  amount: number;
  reason: string;
}

export function detectBalanceAnchors(txs: Transaction[]): BalanceAnchor[] {
  const out: BalanceAnchor[] = [];
  for (const t of txs) {
    const text = `${t.categoryFull} ${t.payee} ${t.comment}`;
    for (const re of ANCHOR_PATTERNS) {
      if (re.test(text)) {
        out.push({
          tx: t,
          amount: t.amountBase * (t.kind === "expense" ? -1 : 1),
          reason: re.source,
        });
        break;
      }
    }
  }
  return out.sort((a, b) => b.tx.date.localeCompare(a.tx.date));
}

export function cumulativeNetAt(txs: Transaction[], date: string): number {
  let net = 0;
  for (const t of txs) {
    if (t.date > date) continue;
    if (t.kind === "income") net += t.amountBase;
    else if (t.kind === "expense") net -= t.amountBase;
  }
  return net;
}

export function lastTransactionDate(txs: Transaction[]): string {
  let max = "";
  for (const t of txs) if (t.date > max) max = t.date;
  return max;
}

export function netWorthSeries(
  allTxs: Transaction[],
  calibration?: CalibrationInput | null
): { date: string; net: number }[] {
  const days = new Map<string, number>();
  for (const t of allTxs) {
    const d = ymdKey(t.date);
    if (!d) continue;
    let delta = 0;
    if (t.kind === "income") delta += t.amountBase;
    else if (t.kind === "expense") delta -= t.amountBase;
    if (delta !== 0) days.set(d, (days.get(d) || 0) + delta);
  }
  const sorted = Array.from(days.keys()).sort();
  let net = 0;
  const raw = sorted.map((d) => {
    net += days.get(d)!;
    return { date: d, net };
  });
  if (!calibration) return raw;

  let rawAtCal = 0;
  for (const p of raw) {
    if (p.date <= calibration.date) rawAtCal = p.net;
    else break;
  }
  const offset = calibration.amount - rawAtCal;
  return raw.map((p) => ({ date: p.date, net: p.net + offset }));
}

export function accountMonthlyDeltas(
  txs: Transaction[],
  account: string,
  months = 12
): number[] {
  const map = new Map<string, number>();
  for (const t of txs) {
    const ym = t.date.slice(0, 7);
    if (!ym) continue;
    let delta = 0;
    if (t.outcomeAccount === account && (t.kind === "expense" || t.kind === "transfer")) {
      delta -= t.amountBase;
    }
    if (t.incomeAccount === account && (t.kind === "income" || t.kind === "transfer")) {
      delta += t.amountBase;
    }
    if (delta !== 0) map.set(ym, (map.get(ym) || 0) + delta);
  }
  const sorted = Array.from(map.keys()).sort();
  const last = sorted.slice(-months);
  return last.map((ym) => Math.round(map.get(ym) || 0));
}

export interface PayeeBucket {
  payee: string;
  total: number;
  count: number;
}

export function topPayees(txs: Transaction[], kind: "expense" | "income" = "expense", limit = 20): PayeeBucket[] {
  const map = new Map<string, PayeeBucket>();
  for (const t of txs) {
    if (t.kind !== kind) continue;
    const key = t.payee || "—";
    let b = map.get(key);
    if (!b) {
      b = { payee: key, total: 0, count: 0 };
      map.set(key, b);
    }
    b.total += t.amountBase;
    b.count++;
  }
  return Array.from(map.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export function topTransactions(
  txs: Transaction[],
  kind: "expense" | "income" = "expense",
  limit = 30
): Transaction[] {
  return txs
    .filter((t) => t.kind === kind)
    .sort((a, b) => b.amountBase - a.amountBase)
    .slice(0, limit);
}

const HASHTAG_RE = /#([\p{L}\p{N}_-]+)/gu;

export function extractHashtags(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(HASHTAG_RE)) out.push(m[1]);
  return out;
}

export interface TagBucket {
  tag: string;
  expense: number;
  income: number;
  count: number;
  txIds: string[];
}

export function groupByHashtag(txs: Transaction[]): TagBucket[] {
  const map = new Map<string, TagBucket>();
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    const tags = extractHashtags(t.comment);
    for (const tag of tags) {
      let b = map.get(tag);
      if (!b) {
        b = { tag, expense: 0, income: 0, count: 0, txIds: [] };
        map.set(tag, b);
      }
      if (t.kind === "income") b.income += t.amountBase;
      else b.expense += t.amountBase;
      b.count++;
      b.txIds.push(t.id);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.expense + b.income - (a.expense + a.income));
}

export interface DayCell {
  date: string;
  expense: number;
  income: number;
  count: number;
}

export function dailyExpenseMap(txs: Transaction[]): Map<string, DayCell> {
  const map = new Map<string, DayCell>();
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    const d = ymdKey(t.date);
    if (!d) continue;
    let cell = map.get(d);
    if (!cell) {
      cell = { date: d, expense: 0, income: 0, count: 0 };
      map.set(d, cell);
    }
    if (t.kind === "income") cell.income += t.amountBase;
    else cell.expense += t.amountBase;
    cell.count++;
  }
  return map;
}

export interface RecurringCandidate {
  payee: string;
  category: string;
  avgAmount: number;
  currency: string;
  occurrences: number;
  avgIntervalDays: number;
  monthsCovered: number;
  consistency: number;
  lastDate: string;
  nextExpected: string;
  totalSpent: number;
  txIds: string[];
}

export function detectRecurring(txs: Transaction[], minOccurrences = 3): RecurringCandidate[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.kind !== "expense") continue;
    if (!t.payee) continue;
    const key = `${t.payee}::${t.currency}`;
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(t);
  }

  const out: RecurringCandidate[] = [];

  for (const [, list] of groups) {
    if (list.length < minOccurrences) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));

    const amounts = list.map((t) => t.amount);
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    if (mean === 0) continue;
    const variance =
      amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length;
    const cv = Math.sqrt(variance) / mean;

    const intervals: number[] = [];
    for (let i = 1; i < list.length; i++) {
      const d = (+new Date(list[i].date) - +new Date(list[i - 1].date)) / 86400000;
      intervals.push(d);
    }
    if (intervals.length === 0) continue;
    const meanInterval = intervals.reduce((s, x) => s + x, 0) / intervals.length;
    if (meanInterval < 5 || meanInterval > 95) continue;

    const intervalVariance =
      intervals.reduce((s, x) => s + (x - meanInterval) ** 2, 0) / intervals.length;
    const intervalCv = Math.sqrt(intervalVariance) / Math.max(meanInterval, 1);

    const consistency = Math.max(0, 1 - cv * 0.5 - intervalCv * 0.5);
    if (consistency < 0.3) continue;

    const months = new Set(list.map((t) => t.date.slice(0, 7)));
    if (months.size < 2) continue;

    const last = list[list.length - 1];
    const nextDate = new Date(last.date);
    nextDate.setDate(nextDate.getDate() + Math.round(meanInterval));

    const totalSpent = list.reduce((s, t) => s + t.amount, 0);
    const cats: Record<string, number> = {};
    for (const t of list) cats[t.category] = (cats[t.category] || 0) + 1;
    const dominantCategory =
      Object.entries(cats).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

    out.push({
      payee: list[0].payee,
      category: dominantCategory,
      avgAmount: mean,
      currency: list[0].currency,
      occurrences: list.length,
      avgIntervalDays: Math.round(meanInterval),
      monthsCovered: months.size,
      consistency,
      lastDate: last.date,
      nextExpected: nextDate.toISOString().slice(0, 10),
      totalSpent,
      txIds: list.map((t) => t.id),
    });
  }

  return out.sort((a, b) => b.totalSpent - a.totalSpent);
}

export interface Insight {
  kind: "highlight" | "trend" | "warning" | "fact";
  title: string;
  body: string;
  value?: number;
  positive?: boolean;
}

export function buildInsights(txs: Transaction[]): Insight[] {
  const insights: Insight[] = [];
  const expenses = txs.filter((t) => t.kind === "expense");
  if (expenses.length === 0) return insights;

  const top = expenses.reduce((m, t) => (t.amountBase > m.amountBase ? t : m), expenses[0]);
  insights.push({
    kind: "highlight",
    title: "Самая крупная трата",
    body: `${top.payee || top.categoryFull} — ${top.comment || top.categoryFull} (${top.date})`,
    value: top.amountBase,
  });

  const dow: number[] = [0, 0, 0, 0, 0, 0, 0];
  const dowCount: number[] = [0, 0, 0, 0, 0, 0, 0];
  for (const t of expenses) {
    const wd = new Date(t.date).getDay();
    dow[wd] += t.amountBase;
    dowCount[wd]++;
  }
  const avgDow = dow.map((s, i) => (dowCount[i] ? s / dowCount[i] : 0));
  const dowNames = ["воскресенье", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];
  let maxIdx = 0;
  for (let i = 0; i < 7; i++) if (avgDow[i] > avgDow[maxIdx]) maxIdx = i;
  insights.push({
    kind: "fact",
    title: "Самый дорогой день",
    body: `В ${dowNames[maxIdx]} средний чек выше всего`,
    value: avgDow[maxIdx],
  });

  const weekend = dow[0] + dow[6];
  const weekday = dow.slice(1, 6).reduce((s, x) => s + x, 0);
  const wkPerDay = weekend / 2;
  const wdPerDay = weekday / 5;
  if (wkPerDay > 0 && wdPerDay > 0) {
    const ratio = wkPerDay / wdPerDay;
    insights.push({
      kind: ratio > 1.3 ? "warning" : "fact",
      title: "Выходные vs будни",
      body:
        ratio > 1.3
          ? `В выходные тратите в ${ratio.toFixed(1)}× больше за день`
          : ratio < 0.8
            ? `В будни тратите в ${(1 / ratio).toFixed(1)}× больше за день`
            : "Расходы по дням недели примерно ровные",
      value: ratio,
    });
  }

  const months = groupByMonth(txs);
  if (months.length >= 2) {
    const last = months[months.length - 1];
    const prev = months[months.length - 2];
    const diff = last.expense - prev.expense;
    const pct = prev.expense > 0 ? diff / prev.expense : 0;
    if (Math.abs(pct) > 0.1) {
      insights.push({
        kind: pct > 0 ? "warning" : "trend",
        title: "Расходы MoM",
        body:
          pct > 0
            ? `В этом месяце расходы выше прошлого на ${(pct * 100).toFixed(0)}%`
            : `В этом месяце расходы ниже прошлого на ${(Math.abs(pct) * 100).toFixed(0)}%`,
        value: pct,
        positive: pct < 0,
      });
    }

    const cats = groupByCategory(txs, "top");
    if (cats.length > 0) {
      const lastTxs = txs.filter((t) => t.date.slice(0, 7) === last.ym);
      const prevTxs = txs.filter((t) => t.date.slice(0, 7) === prev.ym);
      const lastByCat = groupByCategory(lastTxs, "top");
      const prevByCat = new Map(groupByCategory(prevTxs, "top").map((c) => [c.category, c.expense]));
      let bestCat = "";
      let bestDelta = 0;
      for (const c of lastByCat) {
        const prevExp = prevByCat.get(c.category) || 0;
        const delta = c.expense - prevExp;
        if (Math.abs(delta) > Math.abs(bestDelta)) {
          bestDelta = delta;
          bestCat = c.category;
        }
      }
      if (bestCat && Math.abs(bestDelta) > 0) {
        insights.push({
          kind: bestDelta > 0 ? "warning" : "trend",
          title: bestDelta > 0 ? "Категория растёт" : "Категория падает",
          body: `«${bestCat}»: ${bestDelta > 0 ? "+" : ""}${Math.round(bestDelta).toLocaleString("ru-RU")} к прошлому месяцу`,
          value: bestDelta,
          positive: bestDelta < 0,
        });
      }
    }
  }

  const sr = computeKPI(txs);
  if (sr.income > 0) {
    const rate = sr.net / sr.income;
    insights.push({
      kind: rate > 0.2 ? "trend" : rate < 0 ? "warning" : "fact",
      title: "Норма сбережений",
      body:
        rate > 0.2
          ? "Сберегаете больше 20% дохода — отличный результат"
          : rate > 0
            ? `Сберегаете ${(rate * 100).toFixed(0)}% дохода`
            : "Расходы превышают доходы",
      value: rate,
      positive: rate > 0,
    });
  }

  return insights;
}

export interface Anomaly {
  tx: Transaction;
  reason: "outlier-category" | "outlier-payee" | "spike-month";
  zScore: number;
  baseline: number;
  context: string;
}

export function detectAnomalies(txs: Transaction[], threshold = 2.5): Anomaly[] {
  const anomalies: Anomaly[] = [];

  const byCategory = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.kind !== "expense") continue;
    if (!byCategory.has(t.categoryFull)) byCategory.set(t.categoryFull, []);
    byCategory.get(t.categoryFull)!.push(t);
  }

  for (const [cat, list] of byCategory) {
    if (list.length < 5) continue;
    const amounts = list.map((t) => t.amountBase);
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const variance = amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length;
    const std = Math.sqrt(variance);
    if (std === 0) continue;
    for (const t of list) {
      const z = (t.amountBase - mean) / std;
      if (z > threshold) {
        anomalies.push({
          tx: t,
          reason: "outlier-category",
          zScore: z,
          baseline: mean,
          context: `средний по категории «${cat}» — ${Math.round(mean).toLocaleString("ru-RU")}, эта в ${(t.amountBase / mean).toFixed(1)}× больше`,
        });
      }
    }
  }

  const byPayee = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.kind !== "expense" || !t.payee) continue;
    if (!byPayee.has(t.payee)) byPayee.set(t.payee, []);
    byPayee.get(t.payee)!.push(t);
  }

  for (const [payee, list] of byPayee) {
    if (list.length < 5) continue;
    const amounts = list.map((t) => t.amountBase);
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const variance = amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length;
    const std = Math.sqrt(variance);
    if (std === 0) continue;
    for (const t of list) {
      const z = (t.amountBase - mean) / std;
      if (z > threshold) {
        const already = anomalies.some((a) => a.tx.id === t.id);
        if (!already) {
          anomalies.push({
            tx: t,
            reason: "outlier-payee",
            zScore: z,
            baseline: mean,
            context: `обычный чек у «${payee}» — ${Math.round(mean).toLocaleString("ru-RU")}, эта в ${(t.amountBase / mean).toFixed(1)}× больше`,
          });
        }
      }
    }
  }

  return anomalies.sort((a, b) => b.zScore - a.zScore);
}

export interface MonthSpike {
  ym: string;
  category: string;
  current: number;
  baseline: number;
  delta: number;
  ratio: number;
}

export function detectMonthSpikes(txs: Transaction[], minRatio = 1.5): MonthSpike[] {
  const monthsCats = new Map<string, Map<string, number>>();
  for (const t of txs) {
    if (t.kind !== "expense") continue;
    const ym = t.date.slice(0, 7);
    if (!ym) continue;
    let mc = monthsCats.get(ym);
    if (!mc) {
      mc = new Map();
      monthsCats.set(ym, mc);
    }
    mc.set(t.category, (mc.get(t.category) || 0) + t.amountBase);
  }

  const sortedMonths = Array.from(monthsCats.keys()).sort();
  const out: MonthSpike[] = [];

  for (let i = 1; i < sortedMonths.length; i++) {
    const ym = sortedMonths[i];
    const cur = monthsCats.get(ym)!;
    const prev3 = sortedMonths.slice(Math.max(0, i - 3), i);
    if (prev3.length === 0) continue;
    for (const [cat, amount] of cur) {
      let baseSum = 0;
      let baseCount = 0;
      for (const pym of prev3) {
        const v = monthsCats.get(pym)?.get(cat) || 0;
        baseSum += v;
        baseCount++;
      }
      const baseline = baseCount ? baseSum / baseCount : 0;
      if (baseline > 0 && amount / baseline >= minRatio && amount - baseline > 1000) {
        out.push({
          ym,
          category: cat,
          current: amount,
          baseline,
          delta: amount - baseline,
          ratio: amount / baseline,
        });
      }
    }
  }

  return out.sort((a, b) => b.delta - a.delta);
}

export interface CategoryMonthPoint {
  ym: string;
  total: number;
  count: number;
}

export function categoryMonthlySeries(
  txs: Transaction[],
  category: string,
  level: "top" | "full" = "top",
  kind: "expense" | "income" = "expense"
): CategoryMonthPoint[] {
  const map = new Map<string, CategoryMonthPoint>();
  for (const t of txs) {
    if (t.kind !== kind) continue;
    const matches = level === "top" ? t.category === category : t.categoryFull === category;
    if (!matches) continue;
    const ym = t.date.slice(0, 7);
    if (!ym) continue;
    let p = map.get(ym);
    if (!p) {
      p = { ym, total: 0, count: 0 };
      map.set(ym, p);
    }
    p.total += t.amountBase;
    p.count++;
  }
  const allMonths = new Set<string>();
  for (const t of txs) {
    if (t.date) allMonths.add(t.date.slice(0, 7));
  }
  const sorted = Array.from(allMonths).sort();
  return sorted.map((ym) => map.get(ym) || { ym, total: 0, count: 0 });
}

export interface DayOfWeekStat {
  dow: number;
  name: string;
  total: number;
  count: number;
  avg: number;
}

const DOW_NAMES = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const DOW_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export function statsByDayOfWeek(
  txs: Transaction[],
  kind: "expense" | "income" = "expense"
): DayOfWeekStat[] {
  const buckets = Array.from({ length: 7 }, (_, i) => ({
    dow: i,
    name: DOW_NAMES[i],
    short: DOW_SHORT[i],
    total: 0,
    count: 0,
    avg: 0,
  }));
  const dayCount = new Set<string>();
  for (const t of txs) {
    if (t.kind !== kind) continue;
    const d = new Date(t.date);
    const wd = d.getDay();
    buckets[wd].total += t.amountBase;
    buckets[wd].count++;
    dayCount.add(`${wd}-${t.date}`);
  }
  for (const b of buckets) {
    const days = Array.from(dayCount).filter((k) => k.startsWith(`${b.dow}-`)).length;
    b.avg = days > 0 ? b.total / days : 0;
  }
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((i) => buckets[i]);
}

export interface ForecastPoint {
  ym: string;
  income: number;
  expense: number;
  net: number;
  isForecast: boolean;
}

export function buildForecast(txs: Transaction[], monthsAhead = 3, lookback = 6): ForecastPoint[] {
  const months = groupByMonth(txs);
  if (months.length === 0) return [];

  const recent = months.slice(-lookback);
  const avgIncome = recent.reduce((s, m) => s + m.income, 0) / recent.length;
  const avgExpense = recent.reduce((s, m) => s + m.expense, 0) / recent.length;

  const out: ForecastPoint[] = months.map((m) => ({
    ym: m.ym,
    income: m.income,
    expense: m.expense,
    net: m.net,
    isForecast: false,
  }));

  if (months.length === 0) return out;
  const last = months[months.length - 1].ym;
  const [ly, lm] = last.split("-").map(Number);

  for (let i = 1; i <= monthsAhead; i++) {
    const d = new Date(ly, lm - 1 + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({
      ym,
      income: avgIncome,
      expense: avgExpense,
      net: avgIncome - avgExpense,
      isForecast: true,
    });
  }
  return out;
}

export interface KPI {
  income: number;
  expense: number;
  net: number;
  count: number;
  avgExpense: number;
  avgIncome: number;
  daysSpan: number;
  uniqueCategories: number;
  uniquePayees: number;
}

export function computeKPI(txs: Transaction[]): KPI {
  let income = 0;
  let expense = 0;
  let countExp = 0;
  let countInc = 0;
  const cats = new Set<string>();
  const payees = new Set<string>();
  let minD = "";
  let maxD = "";
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    if (t.kind === "income") {
      income += t.amountBase;
      countInc++;
    } else {
      expense += t.amountBase;
      countExp++;
    }
    cats.add(t.categoryFull);
    if (t.payee) payees.add(t.payee);
    const d = t.date;
    if (!minD || d < minD) minD = d;
    if (!maxD || d > maxD) maxD = d;
  }
  const daysSpan =
    minD && maxD
      ? Math.max(1, Math.round((+new Date(maxD) - +new Date(minD)) / 86400000) + 1)
      : 0;
  return {
    income,
    expense,
    net: income - expense,
    count: countExp + countInc,
    avgExpense: countExp ? expense / countExp : 0,
    avgIncome: countInc ? income / countInc : 0,
    daysSpan,
    uniqueCategories: cats.size,
    uniquePayees: payees.size,
  };
}
