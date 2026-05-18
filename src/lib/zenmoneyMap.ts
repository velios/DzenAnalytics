// Pure mapper: turn a Zenmoney diff response into our internal model.
//
// Conventions in Zenmoney:
// - Currency rates are expressed as "1 unit of foreign currency = `rate` RUB",
//   which matches our `CurrencyRates` convention (`1 X = N base`, base=RUB).
// - Tag hierarchy is one level deep: a tag may have `parent` pointing to a
//   parent tag. We surface this as category + subcategory and a slash-joined
//   `categoryFull` so it lines up with our CSV mapping.
// - `transaction.tag` is an array of tag IDs (multi-tagging). We treat the
//   first entry as the primary category.

import type { Transaction, CurrencyRates } from "../types";
import type {
  ZenDiffResponse,
  ZenAccount,
  ZenTag,
  ZenInstrument,
} from "./zenmoney";

export interface MappedDiff {
  transactions: Transaction[];
  rates: CurrencyRates;
  // Totals for status display
  accountsTotal: number;
  accountsActive: number;
  tagsTotal: number;
  baseCurrency: string;
  // For optional calibration helper (sum of startBalances of active accounts in base)
  startBalanceTotal: number;
}

function buildCategory(
  tagIds: string[] | null,
  tagsById: Map<string, ZenTag>
): { category: string; subcategory: string | null; full: string } {
  if (!tagIds || tagIds.length === 0) {
    return { category: "Без категории", subcategory: null, full: "Без категории" };
  }
  const tag = tagsById.get(tagIds[0]);
  if (!tag) {
    return { category: "Без категории", subcategory: null, full: "Без категории" };
  }
  const parent = tag.parent ? tagsById.get(tag.parent) : null;
  if (parent) {
    return {
      category: parent.title,
      subcategory: tag.title,
      full: `${parent.title} / ${tag.title}`,
    };
  }
  return { category: tag.title, subcategory: null, full: tag.title };
}

export function mapZenmoneyDiff(diff: ZenDiffResponse): MappedDiff {
  const accountsById = new Map<string, ZenAccount>(
    diff.account.map((a) => [a.id, a])
  );
  const tagsById = new Map<string, ZenTag>(diff.tag.map((t) => [t.id, t]));
  const instrumentsById = new Map<number, ZenInstrument>(
    diff.instrument.map((i) => [i.id, i])
  );

  // Base currency comes from the user record (instrument id of their default).
  const userCurrencyId = diff.user[0]?.currency;
  const userInstrument = userCurrencyId
    ? instrumentsById.get(userCurrencyId)
    : null;
  const baseCurrency = userInstrument?.shortTitle || "RUB";

  // Build rates relative to base. In Zenmoney, `instrument.rate` is "1 X = rate RUB",
  // so we first normalise everything against RUB, then re-anchor to the user's base
  // if it isn't RUB.
  const ratesVsRub: Record<string, number> = {};
  for (const instr of diff.instrument) {
    ratesVsRub[instr.shortTitle] = instr.rate;
  }
  const baseToRub = ratesVsRub[baseCurrency] || 1;
  const rates: CurrencyRates = {
    base: baseCurrency,
    rates: Object.fromEntries(
      Object.entries(ratesVsRub).map(([cur, r]) => [
        cur,
        cur === baseCurrency ? 1 : Math.round((r / baseToRub) * 1e6) / 1e6,
      ])
    ),
  };

  const toBase = (amount: number, currency: string): number => {
    if (currency === baseCurrency) return amount;
    const r = rates.rates[currency];
    return r ? amount * r : amount;
  };

  const txs: Transaction[] = [];
  for (const zt of diff.transaction) {
    if (zt.deleted) continue;

    const outcome = zt.outcome || 0;
    const income = zt.income || 0;
    if (outcome === 0 && income === 0) continue;

    const outAcc = accountsById.get(zt.outcomeAccount);
    const inAcc = accountsById.get(zt.incomeAccount);
    const outInstr = instrumentsById.get(zt.outcomeInstrument);
    const inInstr = instrumentsById.get(zt.incomeInstrument);

    const outCurrency = outInstr?.shortTitle || baseCurrency;
    const inCurrency = inInstr?.shortTitle || baseCurrency;

    let kind: Transaction["kind"];
    let amount: number;
    let currency: string;
    let account: string;

    const isTransfer =
      outcome > 0 && income > 0 && zt.outcomeAccount !== zt.incomeAccount;

    if (isTransfer) {
      kind = "transfer";
      amount = outcome;
      currency = outCurrency;
      account = outAcc?.title || "";
    } else if (outcome > 0) {
      kind = "expense";
      amount = outcome;
      currency = outCurrency;
      account = outAcc?.title || "";
    } else {
      kind = "income";
      amount = income;
      currency = inCurrency;
      account = inAcc?.title || "";
    }

    const cat = buildCategory(zt.tag, tagsById);

    txs.push({
      id: zt.id,
      date: zt.date,
      category: cat.category,
      subcategory: cat.subcategory,
      categoryFull: cat.full,
      categoryOriginal: cat.category,
      subcategoryOriginal: cat.subcategory,
      categoryFullOriginal: cat.full,
      payee: zt.payee || "",
      payeeOriginal: zt.payee || "",
      comment: zt.comment || "",
      outcomeAccount: outAcc?.title || "",
      outcomeAmount: outcome,
      outcomeCurrency: outCurrency,
      incomeAccount: inAcc?.title || "",
      incomeAmount: income,
      incomeCurrency: inCurrency,
      kind,
      amount,
      currency,
      account,
      amountBase: toBase(amount, currency),
      createdAt: zt.created
        ? new Date(zt.created * 1000).toISOString()
        : `${zt.date}T00:00:00Z`,
    });
  }

  // Sort by date for predictable ordering.
  txs.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : 1
  );

  // Active accounts = !archive && inBalance (those a user would think of as "their money")
  const activeAccounts = diff.account.filter((a) => !a.archive && a.inBalance);
  const startBalanceTotal = activeAccounts.reduce((s, a) => {
    const instr = instrumentsById.get(a.instrument);
    const cur = instr?.shortTitle || baseCurrency;
    return s + toBase(a.startBalance || 0, cur);
  }, 0);

  return {
    transactions: txs,
    rates,
    accountsTotal: diff.account.length,
    accountsActive: activeAccounts.length,
    tagsTotal: diff.tag.length,
    baseCurrency,
    startBalanceTotal,
  };
}
