// Shared test fixtures — minimal builders so each test only spells out
// the fields it actually cares about. Keeps the money-logic tests
// readable instead of drowning them in 25-field object literals.

import type { Transaction, CurrencyRates, TxKind } from "../types";

export const RATES: CurrencyRates = {
  base: "RUB",
  rates: { RUB: 1, USD: 90, EUR: 100 },
};

let seq = 0;

/**
 * Build a Transaction with sensible defaults. `amountBase` defaults to
 * `amount` (i.e. RUB) unless overridden — most tests work in the base
 * currency, and the few that test FX set it explicitly.
 */
export function tx(partial: Partial<Transaction> = {}): Transaction {
  const amount = partial.amount ?? 100;
  const currency = partial.currency ?? "RUB";
  const kind: TxKind = partial.kind ?? "expense";
  const category = partial.category ?? "Еда";
  return {
    id: partial.id ?? `tx-${++seq}`,
    date: partial.date ?? "2026-01-15",
    category,
    subcategory: partial.subcategory ?? null,
    categoryFull: partial.categoryFull ?? category,
    payee: partial.payee ?? "",
    comment: partial.comment ?? "",
    outcomeAccount: partial.outcomeAccount ?? "Карта",
    outcomeAmount: partial.outcomeAmount ?? (kind === "income" ? 0 : amount),
    outcomeCurrency: partial.outcomeCurrency ?? currency,
    incomeAccount: partial.incomeAccount ?? "Карта",
    incomeAmount: partial.incomeAmount ?? (kind === "income" ? amount : 0),
    incomeCurrency: partial.incomeCurrency ?? currency,
    kind,
    amount,
    currency,
    account: partial.account ?? "Карта",
    amountBase: partial.amountBase ?? amount,
    createdAt: partial.createdAt ?? "2026-01-15",
    ...partial,
  };
}
