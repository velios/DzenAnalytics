import type { TxKind } from "../types";

/**
 * Tailwind text-colour class for an amount cell, by kind.
 *
 * Refunds get the accent-2 (violet) palette so they read as visually
 * distinct from income (green). Important — a refund is a cash inflow
 * on the account but logically a *reversal* of an earlier expense; the
 * user shouldn't mistake it for new revenue at a glance.
 */
export function kindColorClass(kind: TxKind): string {
  switch (kind) {
    case "income":
      return "text-income";
    case "expense":
      return "text-expense";
    case "refund":
      return "text-accent2";
    default:
      return "text-warn"; // transfer
  }
}

/**
 * Prefix glyph for the amount column.
 *   +  income, −  expense, ↔  transfer, ↩  refund
 */
export function kindSignGlyph(kind: TxKind): string {
  switch (kind) {
    case "income":
      return "+";
    case "expense":
      return "−";
    case "refund":
      return "↩";
    default:
      return "↔"; // transfer
  }
}

/** Short human-readable name for the kind (used in tooltips, etc.). */
export function kindLabel(kind: TxKind): string {
  switch (kind) {
    case "income":
      return "доход";
    case "expense":
      return "расход";
    case "refund":
      return "возврат";
    default:
      return "перевод";
  }
}
