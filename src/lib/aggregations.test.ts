import { describe, it, expect } from "vitest";
import {
  groupByCategory,
  computeKPI,
  cumulativeNetAt,
  extractHashtags,
  detectDuplicates,
  hashtagCategoryTrees,
} from "./aggregations";
import { tx } from "../test/fixtures";

describe("hashtagCategoryTrees", () => {
  it("builds a per-tag category → subcategory expense tree", () => {
    const trees = hashtagCategoryTrees([
      tx({ comment: "обед #катя", category: "Еда", subcategory: "Кафе", kind: "expense", amountBase: 100 }),
      tx({ comment: "ужин #катя", category: "Еда", subcategory: "Кафе", kind: "expense", amountBase: 50 }),
      tx({ comment: "такси #катя", category: "Транспорт", subcategory: null, kind: "expense", amountBase: 200 }),
      tx({ comment: "#другой", category: "Еда", subcategory: null, kind: "expense", amountBase: 999 }),
    ]);
    const katya = trees.get("катя")!;
    // Sorted by amount desc: Транспорт (200) before Еда (150).
    expect(katya.map((n) => n.category)).toEqual(["Транспорт", "Еда"]);
    const eda = katya.find((n) => n.category === "Еда")!;
    expect(eda.total).toBe(150);
    expect(eda.subs).toEqual([{ name: "Кафе", total: 150, count: 2 }]);
    expect(trees.has("другой")).toBe(true);
  });

  it("excludes income and lets refunds shrink the bucket", () => {
    const trees = hashtagCategoryTrees([
      tx({ comment: "#x", category: "Еда", kind: "expense", amountBase: 500 }),
      tx({ comment: "#x", category: "Еда", kind: "refund", amountBase: 200 }),
      tx({ comment: "#x", category: "Зарплата", kind: "income", amountBase: 9999 }),
    ]);
    const x = trees.get("x")!;
    expect(x).toHaveLength(1);
    expect(x[0]).toMatchObject({ category: "Еда", total: 300 });
  });
});

describe("groupByCategory", () => {
  it("sums expenses per category and ignores transfers", () => {
    const buckets = groupByCategory([
      tx({ category: "Еда", kind: "expense", amountBase: 100 }),
      tx({ category: "Еда", kind: "expense", amountBase: 50 }),
      tx({ category: "Перевод", kind: "transfer", amountBase: 999 }),
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].category).toBe("Еда");
    expect(buckets[0].expense).toBe(150);
  });

  it("treats a refund as a reduction of the category's expense", () => {
    const buckets = groupByCategory([
      tx({ category: "Электроника", kind: "expense", amountBase: 1000 }),
      tx({ category: "Электроника", kind: "refund", amountBase: 300 }),
    ]);
    expect(buckets[0].expense).toBe(700); // 1000 − 300
  });
});

describe("computeKPI", () => {
  it("computes income, expense and net; transfers excluded", () => {
    const k = computeKPI([
      tx({ kind: "income", amountBase: 1000 }),
      tx({ kind: "expense", amountBase: 400 }),
      tx({ kind: "transfer", amountBase: 999 }),
    ]);
    expect(k.income).toBe(1000);
    expect(k.expense).toBe(400);
    expect(k.net).toBe(600);
  });

  it("nets a refund against expense (not income)", () => {
    const k = computeKPI([
      tx({ kind: "expense", amountBase: 500 }),
      tx({ kind: "refund", amountBase: 200 }),
    ]);
    expect(k.expense).toBe(300); // 500 − 200
    expect(k.income).toBe(0);
    expect(k.count).toBe(2); // refund still counts as an operation
  });
});

describe("cumulativeNetAt", () => {
  const txs = [
    tx({ date: "2026-01-01", kind: "income", amountBase: 1000 }),
    tx({ date: "2026-01-10", kind: "expense", amountBase: 300 }),
    tx({ date: "2026-01-20", kind: "refund", amountBase: 100 }),
    tx({ date: "2026-02-01", kind: "expense", amountBase: 500 }),
  ];

  it("accumulates only up to and including the given date", () => {
    expect(cumulativeNetAt(txs, "2026-01-10")).toBe(700); // 1000 − 300
  });

  it("treats a refund as an inflow (same direction as income)", () => {
    expect(cumulativeNetAt(txs, "2026-01-20")).toBe(800); // 1000 − 300 + 100
  });

  it("includes everything when the date is in the future", () => {
    expect(cumulativeNetAt(txs, "2026-12-31")).toBe(300); // 800 − 500
  });
});

describe("extractHashtags", () => {
  it("pulls multiple hashtags out of a comment", () => {
    expect(extractHashtags("Бензин #Mazda3 и мойка #Катя")).toEqual([
      "Mazda3",
      "Катя",
    ]);
  });

  it("returns an empty array for text without hashtags or empty input", () => {
    expect(extractHashtags("обычный комментарий")).toEqual([]);
    expect(extractHashtags("")).toEqual([]);
  });
});

describe("detectDuplicates", () => {
  it("flags two same-amount same-payee same-kind ops within the window", () => {
    const groups = detectDuplicates(
      [
        tx({ id: "a", date: "2026-01-10", payee: "Магнит", amount: 250, kind: "expense" }),
        tx({ id: "b", date: "2026-01-11", payee: "Магнит", amount: 250, kind: "expense" }),
      ],
      3
    );
    expect(groups.length).toBe(1);
  });

  it("does not flag ops far apart in time", () => {
    const groups = detectDuplicates(
      [
        tx({ id: "a", date: "2026-01-01", payee: "Магнит", amount: 250 }),
        tx({ id: "b", date: "2026-02-01", payee: "Магнит", amount: 250 }),
      ],
      3
    );
    expect(groups.length).toBe(0);
  });
});
