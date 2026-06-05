import { describe, it, expect } from "vitest";
import {
  buildDeletions,
  buildPushItems,
  buildResurrections,
} from "./zenmoneyPush";
import type { ZenCache } from "./zenmoneyCache";
import type { ZenAccount, ZenInstrument, ZenTransaction } from "./zenmoney";
import type { TransactionEdit } from "../store/useEditsStore";

/** Minimal ZenTransaction — buildDeletions only reads id/user/deleted. */
function zt(id: string, user: number, deleted = false): ZenTransaction {
  return { id, user, deleted } as ZenTransaction;
}

function cache(transactions: ZenTransaction[]): ZenCache {
  return {
    serverTimestamp: 0,
    instruments: [],
    accounts: [],
    tags: [],
    merchants: [],
    transactions,
    user: [],
  };
}

describe("buildDeletions", () => {
  it("emits a deletion for an id present (and live) in the cache", () => {
    const c = cache([zt("a", 42)]);
    const out = buildDeletions(["a"], c);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a", object: "transaction", user: 42 });
    expect(typeof out[0].stamp).toBe("number");
  });

  it("skips ids that aren't in the cloud cache", () => {
    const c = cache([zt("a", 42)]);
    expect(buildDeletions(["missing"], c)).toEqual([]);
  });

  it("skips transactions already marked deleted (tombstones)", () => {
    const c = cache([zt("a", 42, true)]);
    expect(buildDeletions(["a"], c)).toEqual([]);
  });

  it("carries each transaction's own user id", () => {
    const c = cache([zt("a", 1), zt("b", 2)]);
    const out = buildDeletions(["a", "b"], c);
    expect(out.map((d) => d.user).sort()).toEqual([1, 2]);
  });

  it("returns an empty array for no deleted ids", () => {
    expect(buildDeletions([], cache([zt("a", 1)]))).toEqual([]);
  });
});

describe("buildResurrections", () => {
  const payloads = (txs: ZenTransaction[]) =>
    Object.fromEntries(txs.map((t) => [t.id, t]));
  const mint = () => "NEW";

  it("re-creates a restored, purged payload under a NEW id (deleted:false, fresh changed)", () => {
    const snap = zt("a", 7, true); // snapshot may carry deleted=true
    const out = buildResurrections(payloads([snap]), [], cache([]), 1234, mint);
    expect(out).toHaveLength(1);
    expect(out[0].oldId).toBe("a");
    expect(out[0].tx).toMatchObject({
      id: "NEW",
      user: 7,
      deleted: false,
      changed: 1234,
    });
  });

  it("skips ids still hidden locally (in deletedIds)", () => {
    const snap = zt("a", 7);
    expect(buildResurrections(payloads([snap]), ["a"], cache([]), 1, mint)).toEqual([]);
  });

  it("skips ids the cloud still has LIVE (deletion never pushed)", () => {
    const snap = zt("a", 7);
    expect(
      buildResurrections(payloads([snap]), [], cache([zt("a", 7)]), 1, mint)
    ).toEqual([]);
  });

  it("resurrects an id that's in cache only as a deleted tombstone", () => {
    const snap = zt("a", 7);
    // full sync returns the deleted row as deleted:true → must NOT count
    // as 'present' in the cloud
    const out = buildResurrections(
      payloads([snap]),
      [],
      cache([zt("a", 7, true)]),
      1,
      mint
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ oldId: "a", tx: { id: "NEW", deleted: false } });
  });

  it("returns an empty array when there are no snapshots", () => {
    expect(buildResurrections({}, [], cache([]), 1, mint)).toEqual([]);
  });

  it("mints a distinct new id per resurrection, preserving oldId", () => {
    let n = 0;
    const out = buildResurrections(
      payloads([zt("a", 1), zt("b", 1)]),
      [],
      cache([]),
      1,
      () => `new-${n++}`
    );
    expect(out.map((r) => r.tx.id).sort()).toEqual(["new-0", "new-1"]);
    expect(out.map((r) => r.oldId).sort()).toEqual(["a", "b"]);
  });
});

// ── Kind-flip tests (Phase 2: expense ↔ income ↔ refund) ─────────────

const ACC = "acc-1";
/** A single-account, same-currency transaction in the shape Zenmoney
 *  returns. `outcome>0` → expense; `income>0` → income/refund. */
function fullTx(p: Partial<ZenTransaction>): ZenTransaction {
  return {
    id: "t1",
    user: 1,
    deleted: false,
    changed: 100,
    outcome: 0,
    income: 0,
    outcomeAccount: ACC,
    incomeAccount: ACC,
    outcomeInstrument: 2,
    incomeInstrument: 2,
    opOutcome: 0,
    opIncome: 0,
    outcomeBankID: null,
    incomeBankID: null,
    tag: null,
    ...p,
  } as ZenTransaction;
}

function flipCache(t: ZenTransaction): ZenCache {
  return {
    serverTimestamp: 0,
    instruments: [{ id: 2, shortTitle: "RUB" } as ZenInstrument],
    accounts: [{ id: ACC, title: "Карта" } as ZenAccount],
    tags: [],
    merchants: [],
    transactions: [t],
    user: [],
  };
}

function pushOne(t: ZenTransaction, edit: TransactionEdit) {
  return buildPushItems({ [t.id]: edit }, flipCache(t));
}

describe("buildPushItems — kind flips", () => {
  it("flips expense → income: amount moves to the income leg", () => {
    const { toPush, skipped } = pushOne(fullTx({ outcome: 500 }), { kind: "income" });
    expect(skipped).toHaveLength(0);
    expect(toPush).toHaveLength(1);
    expect(toPush[0].zen.income).toBe(500);
    expect(toPush[0].zen.outcome).toBe(0);
    expect(toPush[0].zen.incomeAccount).toBe(ACC);
  });

  it("flips income → expense: amount moves to the outcome leg", () => {
    const { toPush } = pushOne(fullTx({ income: 89 }), { kind: "expense" });
    expect(toPush[0].zen.outcome).toBe(89);
    expect(toPush[0].zen.income).toBe(0);
  });

  it("flips expense → refund onto the income leg", () => {
    const { toPush, skipped } = pushOne(fullTx({ outcome: 250 }), { kind: "refund" });
    expect(skipped).toHaveLength(0);
    expect(toPush[0].zen.income).toBe(250);
    expect(toPush[0].zen.outcome).toBe(0);
  });

  it("does NOT touch legs when only the amount changes (no kind flip)", () => {
    const { toPush } = pushOne(fullTx({ outcome: 100 }), { amount: 150 });
    expect(toPush[0].zen.outcome).toBe(150);
    expect(toPush[0].zen.income).toBe(0);
  });

  it("refuses a flip to «transfer»", () => {
    const { toPush, skipped } = pushOne(fullTx({ outcome: 100 }), { kind: "transfer" });
    expect(toPush).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/Перевод/);
  });

  it("refuses a flip on an FX row (non-zero op-amount)", () => {
    const fx = fullTx({ outcome: 900, opOutcome: 10 });
    const { toPush, skipped } = pushOne(fx, { kind: "income" });
    expect(toPush).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/валют/i);
  });

  it("does not falsely treat an ordinary expense (opOutcome: 0) as FX", () => {
    const { toPush, skipped } = pushOne(fullTx({ outcome: 100, opOutcome: 0 }), { kind: "income" });
    expect(skipped).toHaveLength(0);
    expect(toPush[0].zen.income).toBe(100);
  });
});
