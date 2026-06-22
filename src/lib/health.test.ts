import { describe, it, expect } from "vitest";
import { computeHealthScore } from "./health";
import { tx } from "../test/fixtures";

describe("computeHealthScore — emergency fund counts off-balance (issue #4)", () => {
  // Six months, 1000 expense each → avg monthly expense = 1000. Calibration
  // anchors the headline net worth to 0, so coverage = extraLiquid / 1000.
  const txs = ["01", "02", "03", "04", "05", "06"].map((m, i) =>
    tx({ id: "e" + i, date: `2026-${m}-15`, kind: "expense", amount: 1000, amountBase: 1000 })
  );
  const base = {
    transactions: txs,
    baseCurrency: "RUB",
    calibration: { date: "2026-06-30", amount: 0 },
    obligatoryCategories: new Set<string>(),
  };
  const coverage = (opts: Parameters<typeof computeHealthScore>[0]) =>
    computeHealthScore(opts).components.find((c) => c.id === "emergency_fund")!.value;

  it("off-balance savings raise the cushion coverage", () => {
    expect(coverage(base)).toBeCloseTo(0, 5);
    expect(coverage({ ...base, extraLiquid: 6000 })).toBeCloseTo(6, 5);
  });
});
