import { describe, it, expect } from "vitest";
import { buildBudgetPush, budgetEditId, type BudgetEdit } from "./zenmoneyPush";
import type { ZenBudget, ZenTag } from "./zenmoney";

const tag = (id: string, title: string, parent: string | null = null): ZenTag => ({
  id,
  user: 7,
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
  user: 7,
  changed: 0,
  date: "2026-06-01",
  tag: null,
  income: 0,
  incomeLock: false,
  outcome: 0,
  outcomeLock: false,
  isIncomeForecast: false,
  isOutcomeForecast: false,
  ...b,
});

const tags = [
  tag("food", "Еда дома"),
  tag("alc", "Алкоголь", "food"),
  tag("work", "Работа"),
];
const edit = (e: Partial<BudgetEdit>): BudgetEdit => ({
  kind: "expense",
  category: "Еда дома",
  subcategory: null,
  ym: "2026-06",
  amount: 50000,
  ...e,
});

describe("buildBudgetPush", () => {
  it("resolves a top-level category to its tag and sets a manual outcome plan", () => {
    const { budgets, skipped } = buildBudgetPush([edit({ amount: 51000 })], [], tags, 1000);
    expect(skipped).toHaveLength(0);
    expect(budgets).toHaveLength(1);
    expect(budgets[0]).toMatchObject({
      tag: "food",
      date: "2026-06-01",
      outcome: 51000,
      isOutcomeForecast: false,
      user: 7,
      changed: 1000,
    });
  });

  it("resolves a sub-category via its parent path", () => {
    const { budgets } = buildBudgetPush(
      [edit({ subcategory: "Алкоголь", amount: 3000 })],
      [],
      tags,
      1000
    );
    expect(budgets[0]).toMatchObject({ tag: "alc", outcome: 3000 });
  });

  it("preserves the income side when pushing an expense plan on the same cell", () => {
    const existing = [budget({ tag: "food", income: 1234, outcome: 9000 })];
    const { budgets } = buildBudgetPush([edit({ amount: 51000 })], existing, tags, 1000);
    expect(budgets[0]).toMatchObject({ tag: "food", outcome: 51000, income: 1234 });
  });

  it("pushes an income plan onto the income side", () => {
    const { budgets } = buildBudgetPush(
      [edit({ kind: "income", category: "Работа", amount: 230000 })],
      [],
      tags,
      1000
    );
    expect(budgets[0]).toMatchObject({
      tag: "work",
      income: 230000,
      isIncomeForecast: false,
      outcome: 0,
    });
  });

  it("drops a no-op (cloud already equals the edit)", () => {
    const existing = [budget({ tag: "food", outcome: 51000, isOutcomeForecast: false })];
    const { budgets, skipped } = buildBudgetPush([edit({ amount: 51000 })], existing, tags, 1000);
    expect(budgets).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });

  it("re-pushes when an existing cell is an auto-forecast (converts to manual)", () => {
    const existing = [budget({ tag: "food", outcome: 51000, isOutcomeForecast: true })];
    const { budgets } = buildBudgetPush([edit({ amount: 51000 })], existing, tags, 1000);
    expect(budgets).toHaveLength(1);
    expect(budgets[0].isOutcomeForecast).toBe(false);
  });

  it("skips an edit whose tag isn't in the cache", () => {
    const { budgets, skipped } = buildBudgetPush(
      [edit({ category: "Призрак" })],
      [],
      tags,
      1000
    );
    expect(budgets).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/тег не найден/);
  });

  it("budgetEditId is stable and distinguishes parent from sub", () => {
    expect(budgetEditId(edit({ subcategory: null }))).not.toBe(
      budgetEditId(edit({ subcategory: "Алкоголь" }))
    );
  });
});
