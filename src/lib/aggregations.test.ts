import { describe, it, expect } from "vitest";
import {
  groupByCategory,
  computeKPI,
  cumulativeNetAt,
  extractHashtags,
  detectDuplicates,
  hashtagCategoryTrees,
  detectRecurring,
  stackedBalanceByAccount,
  netWorthSeries,
  netWorthBasis,
  buildSankey,
  buildObligatorySet,
  splitByObligation,
} from "./aggregations";
import { tx } from "../test/fixtures";
import type { CurrencyRates } from "../types";

describe("buildObligatorySet / splitByObligation — default obligatory", () => {
  const txs = [
    tx({ kind: "expense", category: "Аренда", amount: 100, amountBase: 100 }),
    tx({ kind: "expense", category: "Кафе", amount: 40, amountBase: 40 }),
    tx({ kind: "expense", category: "Развлечения", amount: 10, amountBase: 10 }),
    tx({ kind: "income", category: "Зарплата", amount: 500, amountBase: 500 }),
  ];

  it("treats every expense category as obligatory unless required === false", () => {
    const meta = {
      Кафе: { required: false },
      Развлечения: { required: false },
      // «Аренда» has no meta row → defaults to obligatory.
    };
    const set = buildObligatorySet(txs, meta);
    expect(set.has("Аренда")).toBe(true);
    expect(set.has("Кафе")).toBe(false);
    expect(set.has("Развлечения")).toBe(false);
    // Income categories never enter the set.
    expect(set.has("Зарплата")).toBe(false);
  });

  it("required null/true both count as obligatory", () => {
    const meta = { Аренда: { required: null }, Кафе: { required: true } };
    const set = buildObligatorySet(txs, meta);
    expect(set.has("Аренда")).toBe(true);
    expect(set.has("Кафе")).toBe(true);
  });

  it("splits expense into obligatory vs optional buckets", () => {
    const set = new Set(["Аренда"]);
    const { obligatory, optional } = splitByObligation(txs, set);
    expect(obligatory).toBe(100);
    expect(optional).toBe(50); // Кафе 40 + Развлечения 10; income excluded
  });

  it("empty meta → all expenses obligatory", () => {
    const set = buildObligatorySet(txs, {});
    const { obligatory, optional } = splitByObligation(txs, set);
    expect(obligatory).toBe(150);
    expect(optional).toBe(0);
  });
});

describe("stackedBalanceByAccount — real-balance anchoring", () => {
  const txs = [
    tx({ kind: "income", amount: 300, incomeAccount: "A", date: "2026-01-01" }),
    tx({ kind: "income", amount: 50, incomeAccount: "B", date: "2026-01-01" }),
    tx({ kind: "expense", amount: 100, outcomeAccount: "A", date: "2026-01-02" }),
  ];

  it("without real balances → cumulative flow from zero", () => {
    const { series } = stackedBalanceByAccount(txs, 8);
    const last = series[series.length - 1];
    expect(last.A).toBe(200); // +300 −100
    expect(last.B).toBe(50);
    expect(last.total).toBe(250);
  });

  it("with real balances → lines end at real balance; stack sums to net worth", () => {
    const { series } = stackedBalanceByAccount(txs, 8, { A: 1000, B: 500 });
    const last = series[series.length - 1];
    expect(last.A).toBe(1000);
    expect(last.B).toBe(500);
    expect(last.total).toBe(1500);
    // Shape preserved: before the −100 expense, A's balance was 100 higher.
    expect(series[0].A).toBe(1100);
  });

  it("ranks top accounts by real balance (not turnover) in API mode", () => {
    const t = [
      // C: huge turnover, tiny balance — would top a turnover ranking.
      tx({ kind: "income", amount: 1_000_000, incomeAccount: "C", date: "2026-01-01" }),
      tx({ kind: "expense", amount: 999_000, outcomeAccount: "C", date: "2026-01-02" }),
      tx({ kind: "income", amount: 100, incomeAccount: "A", date: "2026-01-01" }),
      tx({ kind: "income", amount: 100, incomeAccount: "B", date: "2026-01-01" }),
    ];
    const { accounts } = stackedBalanceByAccount(t, 2, { A: 900_000, B: 800_000, C: 1000 });
    expect(accounts).toEqual(expect.arrayContaining(["A", "B", "Прочие"]));
    expect(accounts).not.toContain("C"); // small balance → folded into «Прочие»
  });
});

describe("netWorthSeries — openings & account membership (issue #3)", () => {
  it("seeds opening balances so the curve never dips artificially negative", () => {
    const txs = [
      tx({ kind: "expense", amountBase: 30000, outcomeAccount: "A", account: "A", date: "2020-02-01" }),
      tx({ kind: "expense", amountBase: 40000, outcomeAccount: "A", account: "A", date: "2020-03-01" }),
    ];
    // Without the opening, the cumulative flow goes negative early.
    const noOpening = netWorthSeries(txs);
    expect(Math.min(...noOpening.map((p) => p.net))).toBeLessThan(0);
    // With the opening seeded at the account's start, it stays positive.
    const withOpening = netWorthSeries(txs, null, {
      accounts: new Set(["A"]),
      openings: [{ date: "2020-01-01", amount: 100000 }],
    });
    expect(Math.min(...withOpening.map((p) => p.net))).toBeGreaterThan(0);
    // End = startBalance + flows = real balance.
    expect(withOpening[withOpening.length - 1].net).toBe(30000); // 100k − 30k − 40k
  });

  it("counts only in-set flows; a transfer scores only when it crosses the boundary", () => {
    const txs = [
      tx({ kind: "income", amountBase: 1000, incomeAccount: "A", account: "A", date: "2026-01-01" }),
      tx({ kind: "expense", amountBase: 200, outcomeAccount: "Out", account: "Out", date: "2026-01-02" }), // outside set
      tx({ kind: "transfer", amountBase: 300, outcomeAccount: "A", incomeAccount: "B", date: "2026-01-03" }), // within set → 0
      tx({ kind: "transfer", amountBase: 500, outcomeAccount: "A", incomeAccount: "Out", date: "2026-01-04" }), // leaves set → −500
    ];
    const series = netWorthSeries(txs, null, { accounts: new Set(["A", "B"]) });
    expect(series[series.length - 1].net).toBe(500); // +1000 (in-set income) − 500 (transfer out), «Out» expense ignored
  });
});

describe("netWorthBasis (issue #3)", () => {
  const RUB: CurrencyRates = { base: "RUB", rates: { RUB: 1 } };
  const acc = (over: Partial<Parameters<typeof netWorthBasis>[0][number]>) => ({
    title: "X", currency: "RUB", startBalance: 0, startDate: null, archive: false, inBalance: true, ...over,
  });

  it("includes only non-archived in-balance accounts and dates openings", () => {
    const live = [
      acc({ title: "A", startBalance: 100000, startDate: "2020-01-01" }),
      acc({ title: "B", startBalance: 5000, startDate: null }), // no startDate → earliest tx
      acc({ title: "Old", startBalance: 9, archive: true }),
      acc({ title: "Off", startBalance: 9, inBalance: false }),
    ];
    const txs = [tx({ account: "B", outcomeAccount: "B", date: "2021-03-01" })];
    const { accounts, openings } = netWorthBasis(live, txs, RUB, false);
    expect([...accounts].sort()).toEqual(["A", "B"]);
    expect(openings).toContainEqual({ date: "2020-01-01", amount: 100000 });
    expect(openings).toContainEqual({ date: "2021-03-01", amount: 5000 }); // fell back to first tx
  });

  it("includes off-balance accounts when the toggle is on", () => {
    const live = [acc({ title: "Off", startBalance: 7, inBalance: false, startDate: "2024-01-01" })];
    const { accounts } = netWorthBasis(live, [], RUB, true);
    expect(accounts.has("Off")).toBe(true);
  });
});

describe("detectRecurring — nextExpected projection", () => {
  const NOW = +new Date("2026-06-15T12:00:00Z");
  const monthly = (payee: string, dates: string[]) =>
    dates.map((d) => tx({ payee, kind: "expense", amount: 500, date: d }));

  it("projects «next expected» into the future for a live payment", () => {
    const txs = monthly("Netflix", ["2026-03-10", "2026-04-10", "2026-05-10"]);
    const [c] = detectRecurring(txs, 3, NOW);
    expect(c.payee).toBe("Netflix");
    // last + 1 interval would be ~2026-06-10 (already past NOW) → rolled forward.
    expect(c.nextExpected >= "2026-06-15").toBe(true);
  });

  it("leaves «next expected» in the past for a long-dead payment", () => {
    const txs = monthly("Старый", ["2020-01-10", "2020-02-10", "2020-03-10"]);
    const [c] = detectRecurring(txs, 3, NOW);
    expect(c.lastDate).toBe("2020-03-10");
    expect(c.nextExpected.startsWith("2020")).toBe(true);
    expect(c.stale).toBe(true);
  });

  it("marks a monthly plan silent for a few months as stale (not just >1 year)", () => {
    // Last paid 2026-01-10 → ~5 months before NOW (2026-06-15). Cadence-aware
    // staleness flags it well under a year, and the projection stays in the past.
    const txs = monthly("Заброшенный", ["2025-11-10", "2025-12-10", "2026-01-10"]);
    const [c] = detectRecurring(txs, 3, NOW);
    expect(c.lastDate).toBe("2026-01-10");
    expect(c.stale).toBe(true);
    expect(c.nextExpected < "2026-06-15").toBe(true);
  });

  it("keeps a recently-charged monthly plan active (not stale)", () => {
    const txs = monthly("Живой", ["2026-03-10", "2026-04-10", "2026-05-10"]);
    const [c] = detectRecurring(txs, 3, NOW);
    expect(c.stale).toBe(false);
  });
});

describe("hashtagCategoryTrees", () => {
  it("builds a per-tag category → subcategory tree with expense/income/count", () => {
    const trees = hashtagCategoryTrees([
      tx({ comment: "обед #катя", category: "Еда", subcategory: "Кафе", kind: "expense", amountBase: 100 }),
      tx({ comment: "ужин #катя", category: "Еда", subcategory: "Кафе", kind: "expense", amountBase: 50 }),
      tx({ comment: "такси #катя", category: "Транспорт", subcategory: null, kind: "expense", amountBase: 200 }),
      tx({ comment: "#другой", category: "Еда", subcategory: null, kind: "expense", amountBase: 999 }),
    ]);
    const katya = trees.get("катя")!;
    // Sorted by expense+income desc: Транспорт (200) before Еда (150).
    expect(katya.map((n) => n.category)).toEqual(["Транспорт", "Еда"]);
    const eda = katya.find((n) => n.category === "Еда")!;
    expect(eda).toMatchObject({ expense: 150, income: 0, count: 2 });
    expect(eda.subs).toEqual([{ name: "Кафе", expense: 150, income: 0, count: 2 }]);
    expect(trees.has("другой")).toBe(true);
  });

  it("tracks income in its own bucket and lets refunds shrink expense", () => {
    const trees = hashtagCategoryTrees([
      tx({ comment: "#x", category: "Еда", kind: "expense", amountBase: 500 }),
      tx({ comment: "#x", category: "Еда", kind: "refund", amountBase: 200 }),
      tx({ comment: "#x", category: "Зарплата", kind: "income", amountBase: 9999 }),
    ]);
    const x = trees.get("x")!;
    expect(x).toHaveLength(2);
    expect(x.find((n) => n.category === "Еда")).toMatchObject({ expense: 300, income: 0, count: 2 });
    expect(x.find((n) => n.category === "Зарплата")).toMatchObject({ expense: 0, income: 9999, count: 1 });
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

  it("orders groups by most-recent date first, not by total amount (issue #10)", () => {
    const groups = detectDuplicates(
      [
        // Older but BIGGER duplicate pair.
        tx({ id: "o1", date: "2026-01-10", payee: "Старый", amount: 9000, kind: "expense" }),
        tx({ id: "o2", date: "2026-01-11", payee: "Старый", amount: 9000, kind: "expense" }),
        // Newer but smaller duplicate pair.
        tx({ id: "n1", date: "2026-06-10", payee: "Новый", amount: 100, kind: "expense" }),
        tx({ id: "n2", date: "2026-06-11", payee: "Новый", amount: 100, kind: "expense" }),
      ],
      3
    );
    expect(groups.map((g) => g.txs[0].payee)).toEqual(["Новый", "Старый"]);
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

  it("skips groups whose signature is in the exclusion set («не дубликаты»)", () => {
    const txs = [
      tx({ id: "a", date: "2026-01-10", payee: "Магнит", amount: 250, kind: "expense" }),
      tx({ id: "b", date: "2026-01-11", payee: "Магнит", amount: 250, kind: "expense" }),
    ];
    const sig = detectDuplicates(txs, 3)[0].signature;
    expect(detectDuplicates(txs, 3, new Set([sig]))).toEqual([]);
    // an unrelated signature in the set doesn't suppress real duplicates
    expect(detectDuplicates(txs, 3, new Set(["other"]))).toHaveLength(1);
  });
});

describe("buildSankey — savings & deficit funding (issue #8)", () => {
  const sumLinks = (
    data: ReturnType<typeof buildSankey>,
    pred: (n: { name: string }) => boolean,
    side: "in" | "out"
  ) => {
    const idx = data.nodes.findIndex(pred);
    return data.links
      .filter((l) => (side === "in" ? l.target : l.source) === idx)
      .reduce((s, l) => s + l.value, 0);
  };

  it("adds a Сбережения outflow when income exceeds expenses", () => {
    const data = buildSankey([
      tx({ kind: "income", category: "Зарплата", amount: 1000 }),
      tx({ kind: "expense", category: "Еда", amount: 600 }),
    ]);
    const savings = data.nodes.find((n) => n.kind === "savings");
    expect(savings?.name).toBe("Сбережения");
    expect(data.nodes.some((n) => n.kind === "funding")).toBe(false);
    // budget node stays balanced: 1000 in, 600 expense + 400 savings out
    expect(sumLinks(data, (n) => n.name === "Бюджет", "in")).toBe(1000);
    expect(sumLinks(data, (n) => n.name === "Бюджет", "out")).toBe(1000);
    expect(sumLinks(data, (n) => n.name === "Сбережения", "in")).toBe(400);
  });

  it("adds an Из накоплений inflow when expenses exceed income", () => {
    const data = buildSankey([
      tx({ kind: "income", category: "Зарплата", amount: 400 }),
      tx({ kind: "expense", category: "Еда", amount: 1000 }),
    ]);
    const funding = data.nodes.find((n) => n.kind === "funding");
    expect(funding?.name).toBe("Из накоплений");
    expect(data.nodes.some((n) => n.kind === "savings")).toBe(false);
    // budget node stays balanced: 400 income + 600 funding in, 1000 expense out
    expect(sumLinks(data, (n) => n.name === "Бюджет", "in")).toBe(1000);
    expect(sumLinks(data, (n) => n.name === "Бюджет", "out")).toBe(1000);
    expect(sumLinks(data, (n) => n.name === "Из накоплений", "out")).toBe(600);
  });

  it("adds neither node when income equals expenses", () => {
    const data = buildSankey([
      tx({ kind: "income", category: "Зарплата", amount: 500 }),
      tx({ kind: "expense", category: "Еда", amount: 500 }),
    ]);
    expect(data.nodes.some((n) => n.kind === "savings")).toBe(false);
    expect(data.nodes.some((n) => n.kind === "funding")).toBe(false);
  });
});
