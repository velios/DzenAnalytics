import { describe, it, expect } from "vitest";
import { draftsToTransactions } from "./draftsMap";
import type { ZenCache } from "./zenmoneyCache";
import type { ZenTransaction } from "./zenmoney";

// Reference entities a draft resolves against (live cache). RUB=2, USD=1.
const RUB = 2;
const USD = 1;

function makeCache(): ZenCache {
  return {
    serverTimestamp: 0,
    instruments: [
      { id: RUB, shortTitle: "RUB", title: "Российский рубль", symbol: "₽", rate: 1 },
      { id: USD, shortTitle: "USD", title: "Доллар США", symbol: "$", rate: 90 },
    ] as ZenCache["instruments"],
    accounts: [
      { id: "acc-card", title: "Карта", instrument: RUB, type: "ccard", archive: false, inBalance: true },
      { id: "acc-usd", title: "USD-счёт", instrument: USD, type: "checking", archive: false, inBalance: true },
    ] as unknown as ZenCache["accounts"],
    tags: [
      { id: "tag-food", title: "Еда", parent: null, showOutcome: true, showIncome: false },
      { id: "tag-salary", title: "Зарплата", parent: null, showOutcome: false, showIncome: true },
    ] as unknown as ZenCache["tags"],
    merchants: [],
    transactions: [],
    user: [{ id: 99, currency: RUB } as unknown as ZenCache["user"][number]],
  };
}

/** A draft ZenTransaction with sensible nulls; override the meaningful bits. */
function draft(over: Partial<ZenTransaction>): ZenTransaction {
  return {
    id: "d1",
    user: 99,
    date: "2026-06-14",
    income: 0,
    outcome: 0,
    changed: 0,
    incomeInstrument: RUB,
    outcomeInstrument: RUB,
    created: 0,
    originalPayee: null,
    deleted: false,
    incomeAccount: "acc-card",
    outcomeAccount: "acc-card",
    tag: null,
    comment: null,
    payee: null,
    merchant: null,
    opIncome: null,
    opOutcome: null,
    opIncomeInstrument: null,
    opOutcomeInstrument: null,
    incomeBankID: null,
    outcomeBankID: null,
    ...over,
  } as ZenTransaction;
}

const byId = (txs: ZenTransaction[]) => Object.fromEntries(txs.map((t) => [t.id, t]));

describe("draftsToTransactions", () => {
  it("returns [] with no drafts or no cache", () => {
    expect(draftsToTransactions({}, makeCache())).toEqual([]);
    expect(draftsToTransactions(byId([draft({})]), null)).toEqual([]);
  });

  it("maps a single-leg expense draft", () => {
    const d = draft({
      outcome: 500,
      outcomeAccount: "acc-card",
      incomeAccount: "acc-card",
      tag: ["tag-food"],
      payee: "Пятёрочка",
    });
    const [t] = draftsToTransactions(byId([d]), makeCache());
    expect(t).toMatchObject({
      id: "d1",
      kind: "expense",
      amount: 500,
      currency: "RUB",
      category: "Еда",
      account: "Карта",
      payee: "Пятёрочка",
    });
  });

  it("maps a single-leg income draft", () => {
    const d = draft({
      income: 100000,
      tag: ["tag-salary"],
    });
    const [t] = draftsToTransactions(byId([d]), makeCache());
    expect(t).toMatchObject({
      kind: "income",
      amount: 100000,
      currency: "RUB",
      category: "Зарплата",
    });
  });

  it("maps a cross-currency transfer draft (RUB → USD legs in their own currencies)", () => {
    const d = draft({
      outcome: 9000,
      income: 100,
      outcomeAccount: "acc-card",
      outcomeInstrument: RUB,
      incomeAccount: "acc-usd",
      incomeInstrument: USD,
    });
    const [t] = draftsToTransactions(byId([d]), makeCache());
    expect(t).toMatchObject({
      kind: "transfer",
      category: "Перевод",
      outcomeAmount: 9000,
      outcomeCurrency: "RUB",
      incomeAmount: 100,
      incomeCurrency: "USD",
    });
  });

  it("recomputes amountBase via the cache rates (USD expense → RUB base)", () => {
    const d = draft({
      outcome: 100,
      outcomeAccount: "acc-usd",
      incomeAccount: "acc-usd",
      outcomeInstrument: USD,
      incomeInstrument: USD,
      tag: ["tag-food"],
    });
    const [t] = draftsToTransactions(byId([d]), makeCache());
    expect(t.currency).toBe("USD");
    expect(t.amountBase).toBe(9000); // 100 USD × 90
  });
});
