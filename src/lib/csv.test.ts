import { describe, it, expect } from "vitest";
import { toBase, buildTransaction } from "./csv";
import type { RawRow } from "../types";
import { RATES } from "../test/fixtures";

describe("toBase", () => {
  it("returns the amount unchanged when currency is the base", () => {
    expect(toBase(123.45, "RUB", RATES)).toBe(123.45);
  });

  it("multiplies by the currency rate", () => {
    expect(toBase(10, "USD", RATES)).toBe(900); // 10 × 90
    expect(toBase(2, "EUR", RATES)).toBe(200); // 2 × 100
  });

  it("falls back to the raw amount for an unknown currency", () => {
    // No rate → we don't silently zero the money out; keep the number.
    expect(toBase(50, "XYZ", RATES)).toBe(50);
  });
});

/** Minimal RawRow builder for buildTransaction tests. */
function row(p: Partial<RawRow> = {}): RawRow {
  return {
    date: "2026-01-15",
    categoryName: "",
    payee: "",
    comment: "",
    outcomeAccountName: "Карта",
    outcome: "",
    outcomeCurrencyShortTitle: "RUB",
    incomeAccountName: "Карта",
    income: "",
    incomeCurrencyShortTitle: "RUB",
    createdDate: "2026-01-15",
    changedDate: "2026-01-15",
    qrCode: "",
    ...p,
  } as RawRow;
}

describe("buildTransaction — classification", () => {
  it("classifies an outcome-only row as expense", () => {
    const t = buildTransaction(row({ outcome: "500" }), 0, RATES);
    expect(t.kind).toBe("expense");
    expect(t.amount).toBe(500);
  });

  it("classifies an income-only row as income", () => {
    const t = buildTransaction(row({ income: "1000" }), 0, RATES);
    expect(t.kind).toBe("income");
    expect(t.amount).toBe(1000);
  });

  it("classifies two-sided different-account rows as transfer", () => {
    const t = buildTransaction(
      row({
        outcome: "300",
        income: "300",
        outcomeAccountName: "Карта",
        incomeAccountName: "Наличные",
      }),
      0,
      RATES
    );
    expect(t.kind).toBe("transfer");
    expect(t.category).toBe("Перевод");
  });

  it("parses comma decimals and strips spaces in amounts", () => {
    const t = buildTransaction(row({ outcome: "1 234,56" }), 0, RATES);
    expect(t.amount).toBeCloseTo(1234.56, 2);
  });

  it("splits 'A / B' category into category + subcategory", () => {
    const t = buildTransaction(
      row({ outcome: "1", categoryName: "Еда дома / Алкоголь" }),
      0,
      RATES
    );
    expect(t.category).toBe("Еда дома");
    expect(t.subcategory).toBe("Алкоголь");
    expect(t.categoryFull).toBe("Еда дома / Алкоголь");
  });

  it("defaults a blank category to 'Без категории'", () => {
    const t = buildTransaction(row({ outcome: "1" }), 0, RATES);
    expect(t.category).toBe("Без категории");
  });

  it("converts a foreign-currency amount into base for amountBase", () => {
    const t = buildTransaction(
      row({ outcome: "10", outcomeCurrencyShortTitle: "USD" }),
      0,
      RATES
    );
    expect(t.currency).toBe("USD");
    expect(t.amountBase).toBe(900); // 10 USD × 90
  });
});
