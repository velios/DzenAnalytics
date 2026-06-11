import { describe, it, expect } from "vitest";
import {
  monthDiff,
  addMonths,
  plannedFor,
  monthlyEquivalent,
  factFor,
  migrateLegacyBudgets,
  type BudgetLine,
} from "./budgets";
import { tx } from "../test/fixtures";

const line = (over: Partial<BudgetLine> = {}): BudgetLine => ({
  id: "1",
  category: "Еда",
  kind: "expense",
  amount: 10000,
  recurrence: "monthly",
  startMonth: "2026-01",
  endMonth: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("monthDiff / addMonths", () => {
  it("counts whole months between YYYY-MM", () => {
    expect(monthDiff("2026-01", "2026-04")).toBe(3);
    expect(monthDiff("2026-04", "2026-01")).toBe(-3);
    expect(monthDiff("2025-11", "2026-02")).toBe(3);
  });
  it("adds months across year boundaries", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-03", -5)).toBe("2025-10");
  });
});

describe("plannedFor", () => {
  it("monthly: amount every month inside the window", () => {
    const l = line({ recurrence: "monthly", startMonth: "2026-01", endMonth: "2026-12" });
    expect(plannedFor(l, "2026-01")).toBe(10000);
    expect(plannedFor(l, "2026-07")).toBe(10000);
    expect(plannedFor(l, "2025-12")).toBe(0); // before start
    expect(plannedFor(l, "2027-01")).toBe(0); // after end
  });

  it("quarterly: lands on every 3rd month from start, zero elsewhere", () => {
    const l = line({ recurrence: "quarterly", amount: 30000, startMonth: "2026-02" });
    expect(plannedFor(l, "2026-02")).toBe(30000);
    expect(plannedFor(l, "2026-03")).toBe(0);
    expect(plannedFor(l, "2026-05")).toBe(30000);
    expect(plannedFor(l, "2026-08")).toBe(30000);
  });

  it("yearly: lands once a year on the anchor month", () => {
    const l = line({ recurrence: "yearly", amount: 60000, startMonth: "2026-03" });
    expect(plannedFor(l, "2026-03")).toBe(60000);
    expect(plannedFor(l, "2026-09")).toBe(0);
    expect(plannedFor(l, "2027-03")).toBe(60000);
  });

  it("once: only the start month", () => {
    const l = line({ recurrence: "once", amount: 5000, startMonth: "2026-04" });
    expect(plannedFor(l, "2026-04")).toBe(5000);
    expect(plannedFor(l, "2026-05")).toBe(0);
  });

  it("override beats the computed plan for that month", () => {
    const l = line({ recurrence: "monthly", overrides: { "2026-03": 25000 } });
    expect(plannedFor(l, "2026-02")).toBe(10000);
    expect(plannedFor(l, "2026-03")).toBe(25000);
  });

  it("override of 0 explicitly zeroes a month", () => {
    const l = line({ recurrence: "monthly", overrides: { "2026-03": 0 } });
    expect(plannedFor(l, "2026-03")).toBe(0);
  });
});

describe("monthlyEquivalent", () => {
  it("spreads quarterly/yearly, passes monthly, zeroes one-off", () => {
    expect(monthlyEquivalent(line({ recurrence: "monthly", amount: 9000 }))).toBe(9000);
    expect(monthlyEquivalent(line({ recurrence: "quarterly", amount: 9000 }))).toBe(3000);
    expect(monthlyEquivalent(line({ recurrence: "yearly", amount: 12000 }))).toBe(1000);
    expect(monthlyEquivalent(line({ recurrence: "once", amount: 9000 }))).toBe(0);
  });
});

describe("factFor", () => {
  const txs = [
    tx({ category: "Еда", kind: "expense", amountBase: 1000, date: "2026-03-05" }),
    tx({ category: "Еда", kind: "refund", amountBase: 300, date: "2026-03-10" }),
    tx({ category: "Еда", kind: "expense", amountBase: 500, date: "2026-04-01" }),
    tx({ category: "Зарплата", kind: "income", amountBase: 90000, date: "2026-03-25" }),
  ];

  it("expense line nets refunds within the month", () => {
    expect(factFor(line({ category: "Еда" }), txs, "2026-03")).toBe(700); // 1000 − 300
    expect(factFor(line({ category: "Еда" }), txs, "2026-04")).toBe(500);
  });

  it("income line sums income for the category/month", () => {
    const l = line({ category: "Зарплата", kind: "income" });
    expect(factFor(l, txs, "2026-03")).toBe(90000);
    expect(factFor(l, txs, "2026-04")).toBe(0);
  });
});

describe("migrateLegacyBudgets", () => {
  it("turns flat limits into open-ended monthly expense lines", () => {
    const lines = migrateLegacyBudgets({ Еда: 10000, Транспорт: 5000, Пустой: 0 }, "2026-06", 111);
    expect(lines).toHaveLength(2); // zero-amount dropped
    expect(lines[0]).toMatchObject({
      category: "Еда",
      kind: "expense",
      amount: 10000,
      recurrence: "monthly",
      startMonth: "2026-06",
      endMonth: null,
    });
  });

  it("returns [] for null/empty input", () => {
    expect(migrateLegacyBudgets(null, "2026-06")).toEqual([]);
    expect(migrateLegacyBudgets({}, "2026-06")).toEqual([]);
  });
});
