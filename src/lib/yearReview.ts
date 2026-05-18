import type { Transaction } from "../types";
import { groupByMonth, groupByCategory } from "./aggregations";

export interface YearTopItem {
  name: string;
  amount: number;
  count: number;
}

export interface YearMonthlyPoint {
  ym: string;
  income: number;
  expense: number;
  net: number;
}

export interface YearReview {
  year: number;
  hasData: boolean;
  // Headline numbers
  totalIncome: number;
  totalExpense: number;
  netFlow: number;
  savingsRate: number;
  txCount: number;

  // Comparison to previous year (if available)
  prev: {
    available: boolean;
    income: number;
    expense: number;
    net: number;
    incomeDelta: number;     // (this - prev) / prev
    expenseDelta: number;
    netDelta: number;
  };

  // Tops
  topCategories: YearTopItem[];   // by expense
  topPayees: YearTopItem[];        // by expense
  topTransactions: Transaction[]; // largest single expenses

  // Highlights
  bestMonth: YearMonthlyPoint | null;    // most income or net positive
  worstMonth: YearMonthlyPoint | null;   // most expense or net negative
  recordMonths: {
    biggestIncome: YearMonthlyPoint | null;
    biggestExpense: YearMonthlyPoint | null;
    bestSaving: YearMonthlyPoint | null; // highest net
  };

  // Patterns
  favoriteWeekday: { weekday: number; name: string; total: number }; // 0=Mon..6=Sun
  monthly: YearMonthlyPoint[];

  // Fun facts
  avgPerDay: number;        // expense per day
  longestStreak: number;   // longest streak of days without expense
  uniqueMerchants: number;
  uniqueCategories: number;
}

const WEEKDAY_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function inYear(dateStr: string, year: number): boolean {
  return dateStr.startsWith(`${year}-`);
}

function weekdayMonFirst(d: Date): number {
  // JS: Sun=0, Mon=1, ... → Mon=0, ... Sun=6
  return (d.getDay() + 6) % 7;
}

function dayList(year: number): string[] {
  const days: string[] = [];
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    days.push(`${d.getFullYear()}-${mm}-${dd}`);
  }
  return days;
}

export function availableYears(transactions: Transaction[]): number[] {
  const set = new Set<number>();
  for (const t of transactions) {
    const y = Number(t.date.slice(0, 4));
    if (Number.isFinite(y)) set.add(y);
  }
  return Array.from(set).sort((a, b) => b - a);
}

export function buildYearReview(
  transactions: Transaction[],
  year: number
): YearReview {
  const thisYear = transactions.filter((t) => inYear(t.date, year));
  const prevYear = transactions.filter((t) => inYear(t.date, year - 1));

  const empty: YearReview = {
    year,
    hasData: false,
    totalIncome: 0,
    totalExpense: 0,
    netFlow: 0,
    savingsRate: 0,
    txCount: 0,
    prev: {
      available: prevYear.length > 0,
      income: 0,
      expense: 0,
      net: 0,
      incomeDelta: 0,
      expenseDelta: 0,
      netDelta: 0,
    },
    topCategories: [],
    topPayees: [],
    topTransactions: [],
    bestMonth: null,
    worstMonth: null,
    recordMonths: { biggestIncome: null, biggestExpense: null, bestSaving: null },
    favoriteWeekday: { weekday: 0, name: WEEKDAY_RU[0], total: 0 },
    monthly: [],
    avgPerDay: 0,
    longestStreak: 0,
    uniqueMerchants: 0,
    uniqueCategories: 0,
  };

  if (thisYear.length === 0) return empty;

  // Headline aggregates
  let totalIncome = 0;
  let totalExpense = 0;
  for (const t of thisYear) {
    if (t.kind === "income") totalIncome += t.amountBase;
    else if (t.kind === "expense") totalExpense += t.amountBase;
  }
  const netFlow = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? netFlow / totalIncome : 0;

  // Previous year totals
  let prevIncome = 0;
  let prevExpense = 0;
  for (const t of prevYear) {
    if (t.kind === "income") prevIncome += t.amountBase;
    else if (t.kind === "expense") prevExpense += t.amountBase;
  }
  const prevNet = prevIncome - prevExpense;
  const dRel = (cur: number, prev: number) =>
    Math.abs(prev) > 0.01 ? (cur - prev) / Math.abs(prev) : 0;

  // Monthly aggregates
  const monthly: YearMonthlyPoint[] = groupByMonth(thisYear).map((m) => ({
    ym: m.ym,
    income: m.income,
    expense: m.expense,
    net: m.net,
  }));

  // Best / worst month: highest income; highest expense; best net.
  let biggestIncome = monthly[0] || null;
  let biggestExpense = monthly[0] || null;
  let bestSaving = monthly[0] || null;
  for (const m of monthly) {
    if (!biggestIncome || m.income > biggestIncome.income) biggestIncome = m;
    if (!biggestExpense || m.expense > biggestExpense.expense) biggestExpense = m;
    if (!bestSaving || m.net > bestSaving.net) bestSaving = m;
  }

  // Top categories / payees / transactions (expenses only)
  const cats = groupByCategory(thisYear);
  const topCategories: YearTopItem[] = cats.slice(0, 8).map((c) => ({
    name: c.category,
    amount: c.expense,
    count: c.count,
  }));

  const payeeMap = new Map<string, { amount: number; count: number }>();
  for (const t of thisYear) {
    if (t.kind !== "expense") continue;
    const key = t.payee || "—";
    const cur = payeeMap.get(key) || { amount: 0, count: 0 };
    cur.amount += t.amountBase;
    cur.count++;
    payeeMap.set(key, cur);
  }
  const topPayees: YearTopItem[] = Array.from(payeeMap.entries())
    .map(([name, v]) => ({ name, amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const topTransactions = [...thisYear]
    .filter((t) => t.kind === "expense")
    .sort((a, b) => b.amountBase - a.amountBase)
    .slice(0, 5);

  // Favorite weekday (by expense total)
  const weekdayTotals = new Array(7).fill(0) as number[];
  const merchants = new Set<string>();
  const categories = new Set<string>();
  const expenseDays = new Set<string>();
  for (const t of thisYear) {
    if (t.kind === "expense") {
      const d = new Date(t.date);
      if (!Number.isNaN(d.getTime())) {
        weekdayTotals[weekdayMonFirst(d)] += t.amountBase;
      }
      expenseDays.add(t.date.slice(0, 10));
    }
    if (t.payee) merchants.add(t.payee);
    if (t.category) categories.add(t.category);
  }
  let fwdIdx = 0;
  for (let i = 1; i < 7; i++) {
    if (weekdayTotals[i] > weekdayTotals[fwdIdx]) fwdIdx = i;
  }

  // Longest streak of days without expenses (within the year)
  const allDays = dayList(year);
  let curStreak = 0;
  let longestStreak = 0;
  for (const d of allDays) {
    if (expenseDays.has(d)) {
      curStreak = 0;
    } else {
      curStreak++;
      if (curStreak > longestStreak) longestStreak = curStreak;
    }
  }

  return {
    year,
    hasData: true,
    totalIncome,
    totalExpense,
    netFlow,
    savingsRate,
    txCount: thisYear.length,
    prev: {
      available: prevYear.length > 0,
      income: prevIncome,
      expense: prevExpense,
      net: prevNet,
      incomeDelta: dRel(totalIncome, prevIncome),
      expenseDelta: dRel(totalExpense, prevExpense),
      netDelta: dRel(netFlow, prevNet),
    },
    topCategories,
    topPayees,
    topTransactions,
    bestMonth: bestSaving,
    worstMonth: biggestExpense,
    recordMonths: { biggestIncome, biggestExpense, bestSaving },
    favoriteWeekday: {
      weekday: fwdIdx,
      name: WEEKDAY_RU[fwdIdx],
      total: weekdayTotals[fwdIdx],
    },
    monthly,
    avgPerDay: totalExpense / Math.max(1, allDays.length),
    longestStreak,
    uniqueMerchants: merchants.size,
    uniqueCategories: categories.size,
  };
}
