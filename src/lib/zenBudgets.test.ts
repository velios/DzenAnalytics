import { describe, it, expect } from "vitest";
import { zenPlansFromBudgets, zenPlanKey } from "./zenBudgets";
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

  it("maps a locked outcome budget to its category + month", () => {
    const m = zenPlansFromBudgets(
      [budget({ tag: "food", outcome: 5000, outcomeLock: true })],
      tags
    );
    expect(m.get(zenPlanKey("expense", "Еда", "2026-06"))).toBe(5000);
  });

  it("ignores unlocked (forecast) and zero amounts", () => {
    const m = zenPlansFromBudgets(
      [
        budget({ tag: "food", outcome: 9999, outcomeLock: false }), // forecast
        budget({ tag: "food", outcome: 0, outcomeLock: true, date: "2026-07-01" }), // zero
      ],
      tags
    );
    expect(m.size).toBe(0);
  });

  it("rolls a sub-tag budget up to its parent category", () => {
    const m = zenPlansFromBudgets(
      [budget({ tag: "clothes", outcome: 3000, outcomeLock: true })],
      tags
    );
    expect(m.get(zenPlanKey("expense", "Покупки", "2026-06"))).toBe(3000);
  });

  it("sums siblings under the same parent and keeps income separate", () => {
    const m = zenPlansFromBudgets(
      [
        budget({ tag: "clothes", outcome: 3000, outcomeLock: true }),
        budget({ tag: "shop", outcome: 2000, outcomeLock: true }),
        budget({ tag: "food", income: 1000, incomeLock: true }),
      ],
      tags
    );
    expect(m.get(zenPlanKey("expense", "Покупки", "2026-06"))).toBe(5000);
    expect(m.get(zenPlanKey("income", "Еда", "2026-06"))).toBe(1000);
  });

  it("skips the whole-month aggregate (tag null) and unknown tags", () => {
    const m = zenPlansFromBudgets(
      [
        budget({ tag: null, outcome: 8000, outcomeLock: true }),
        budget({ tag: "ghost", outcome: 4000, outcomeLock: true }),
      ],
      tags
    );
    expect(m.size).toBe(0);
  });
});
