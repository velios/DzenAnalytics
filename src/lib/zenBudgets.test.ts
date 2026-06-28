import { describe, it, expect } from "vitest";
import { zenPlanList, zenPlansFromBudgets, zenPlanKey } from "./zenBudgets";
import type { ZenBudget, ZenTag } from "./zenmoney";

const tag = (id: string, title: string, parent: string | null = null): ZenTag => ({
  id,
  user: 1,
  changed: 0,
  title,
  parent,
  archive: false,
  showIncome: true,
  showOutcome: true,
  budgetIncome: true,
  budgetOutcome: true,
  required: null,
  color: null,
  icon: null,
  picture: null,
});

const budget = (b: Partial<ZenBudget>): ZenBudget => ({
  user: 1,
  changed: 0,
  date: "2026-06-01",
  tag: null,
  income: 0,
  incomeLock: false,
  outcome: 0,
  outcomeLock: false,
  ...b,
});

describe("zenPlansFromBudgets", () => {
  const tags = [tag("food", "Еда"), tag("shop", "Покупки"), tag("clothes", "Одежда", "shop")];

  it("maps a real outcome budget (lock=false, not a forecast) to category + month", () => {
    // Regression: real Zenmoney budgets leave `outcomeLock: false`; the manual
    // vs forecast distinction is `isOutcomeForecast`, not the lock.
    const m = zenPlansFromBudgets(
      [budget({ tag: "food", outcome: 5000, outcomeLock: false })],
      tags
    );
    expect(m.get(zenPlanKey("expense", "Еда", null, "2026-06"))).toBe(5000);
  });

  it("ignores auto-forecast and zero amounts", () => {
    const m = zenPlansFromBudgets(
      [
        budget({ tag: "food", outcome: 9999, isOutcomeForecast: true }), // forecast
        budget({ tag: "food", outcome: 0, date: "2026-07-01" }), // zero
      ],
      tags
    );
    expect(m.size).toBe(0);
  });

  it("keeps a sub-tag budget on its own (category=parent title, subcategory=sub title)", () => {
    const m = zenPlansFromBudgets([budget({ tag: "clothes", outcome: 3000 })], tags);
    // Per-tag: NOT rolled up into the parent — addressable as a sub-line.
    expect(m.get(zenPlanKey("expense", "Покупки", "Одежда", "2026-06"))).toBe(3000);
    expect(m.get(zenPlanKey("expense", "Покупки", null, "2026-06"))).toBeUndefined();
  });

  it("keeps parent and sub plans separate (no summing) and income apart", () => {
    const m = zenPlansFromBudgets(
      [
        budget({ tag: "clothes", outcome: 3000 }), // sub «Одежда»
        budget({ tag: "shop", outcome: 2000 }), // parent «Покупки»
        budget({ tag: "food", income: 1000 }),
      ],
      tags
    );
    expect(m.get(zenPlanKey("expense", "Покупки", "Одежда", "2026-06"))).toBe(3000);
    expect(m.get(zenPlanKey("expense", "Покупки", null, "2026-06"))).toBe(2000);
    expect(m.get(zenPlanKey("income", "Еда", null, "2026-06"))).toBe(1000);
  });

  it("skips the whole-month aggregate (tag null / all-zeros UUID) and unknown tags", () => {
    const m = zenPlansFromBudgets(
      [
        budget({ tag: null, outcome: 8000 }),
        budget({ tag: "00000000-0000-0000-0000-000000000000", outcome: 7000 }),
        budget({ tag: "ghost", outcome: 4000 }),
      ],
      tags
    );
    expect(m.size).toBe(0);
  });
});

describe("zenPlanList", () => {
  const tags = [tag("shop", "Покупки"), tag("clothes", "Одежда", "shop")];

  it("returns structured per-tag entries with subcategory", () => {
    const list = zenPlanList(
      [
        budget({ tag: "shop", outcome: 2000 }),
        budget({ tag: "clothes", outcome: 3000, date: "2026-05-01" }),
      ],
      tags
    );
    expect(list).toContainEqual({
      kind: "expense",
      category: "Покупки",
      subcategory: null,
      ym: "2026-06",
      amount: 2000,
    });
    expect(list).toContainEqual({
      kind: "expense",
      category: "Покупки",
      subcategory: "Одежда",
      ym: "2026-05",
      amount: 3000,
    });
  });
});
