import type { Transaction } from "../types";
import { affectsExpense, expenseDelta } from "./txKindStyle";

/**
 * Budget model — "plan/fact by month", richer than the old flat
 * `Record<category, number>`.
 *
 * A {@link BudgetLine} carries a planned amount for a single *period*, a
 * recurrence, and a validity window. The per-month planned value is derived
 * (see {@link plannedFor}) and can be overridden for individual months
 * (`overrides`), which is how "tweak just this month" and "copy plan forward"
 * are expressed.
 */

/** Расходный или доходный бюджет — решает раздел и знак сравнения. */
export type BudgetKind = "expense" | "income";

/** Как часто действует плановая сумма. */
export type Recurrence = "monthly" | "quarterly" | "yearly" | "once";

export interface BudgetLine {
  id: string;
  category: string;
  kind: BudgetKind;
  /** Плановая сумма за ОДИН период (не за месяц для quarterly/yearly). */
  amount: number;
  recurrence: Recurrence;
  /** "YYYY-MM" — первый месяц действия. */
  startMonth: string;
  /** "YYYY-MM" — последний месяц действия, или null = бессрочно. */
  endMonth: string | null;
  /** Точечные правки конкретных месяцев: "YYYY-MM" → сумма. */
  overrides?: Record<string, number>;
  createdAt: string;
}

/** Months elapsed from `a` to `b` (both "YYYY-MM"); negative if b < a. */
export function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Add `n` whole months to a "YYYY-MM" string. */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  return `${ny}-${String(nm + 1).padStart(2, "0")}`;
}

/**
 * Does this line's recurrence "land" on month `ym`, ignoring overrides and the
 * window? quarterly/yearly land on a single month per period (anchored to
 * `startMonth`), matching how such payments actually hit (insurance once a
 * year, not 1/12 every month).
 */
function recurrenceHits(line: BudgetLine, ym: string): boolean {
  const d = monthDiff(line.startMonth, ym);
  if (d < 0) return false;
  switch (line.recurrence) {
    case "monthly":
      return true;
    case "quarterly":
      return d % 3 === 0;
    case "yearly":
      return d % 12 === 0;
    case "once":
      return d === 0;
  }
}

/**
 * Planned amount for a given month. Priority:
 *   1. explicit per-month override;
 *   2. the period amount, when `ym` is inside [startMonth, endMonth] AND the
 *      recurrence lands on that month;
 *   3. otherwise 0.
 */
export function plannedFor(line: BudgetLine, ym: string): number {
  const ov = line.overrides?.[ym];
  if (ov !== undefined) return ov;
  if (ym < line.startMonth) return 0;
  if (line.endMonth && ym > line.endMonth) return 0;
  return recurrenceHits(line, ym) ? line.amount : 0;
}

/**
 * Rough monthly-equivalent of a line, for "≈ per month" roll-ups. Spreads
 * quarterly/yearly across their cycle; a one-off contributes nothing to a
 * steady monthly figure.
 */
export function monthlyEquivalent(line: BudgetLine): number {
  switch (line.recurrence) {
    case "monthly":
      return line.amount;
    case "quarterly":
      return line.amount / 3;
    case "yearly":
      return line.amount / 12;
    case "once":
      return 0;
  }
}

/**
 * Actual amount for a line in month `ym`, derived from transactions.
 *   • expense line → Σ expenseDelta (expense minus refunds) over the category;
 *   • income line  → Σ amountBase of income transactions over the category.
 */
export function factFor(
  line: BudgetLine,
  txs: Transaction[],
  ym: string
): number {
  let sum = 0;
  for (const t of txs) {
    if (t.category !== line.category) continue;
    if (!t.date.startsWith(ym)) continue;
    if (line.kind === "income") {
      if (t.kind === "income") sum += t.amountBase;
    } else if (affectsExpense(t.kind)) {
      sum += expenseDelta(t);
    }
  }
  return sum;
}

/**
 * Migrate the legacy flat budgets (`Record<category, monthlyLimit>`) into the
 * new line model: every entry becomes an open-ended monthly expense line
 * starting at `startMonth` (default: the current month). Behaviour is
 * unchanged for existing users — a monthly expense limit on every month.
 */
export function migrateLegacyBudgets(
  legacy: Record<string, number> | null | undefined,
  startMonth: string,
  now = Date.now()
): BudgetLine[] {
  if (!legacy) return [];
  return Object.entries(legacy)
    .filter(([, amount]) => amount > 0)
    .map(([category, amount], i) => ({
      id: `mig-${now}-${i}`,
      category,
      kind: "expense" as const,
      amount,
      recurrence: "monthly" as const,
      startMonth,
      endMonth: null,
      createdAt: new Date(now).toISOString(),
    }));
}
