import { describe, it, expect } from "vitest";
import { applyDiff, type ZenCache } from "./zenmoneyCache";
import type {
  ZenAccount,
  ZenTransaction,
  ZenDiffResponse,
} from "./zenmoney";

const acc = (id: string) => ({ id, title: `Acc ${id}` }) as ZenAccount;
const txn = (id: string, out: string, inc: string) =>
  ({ id, outcomeAccount: out, incomeAccount: inc }) as ZenTransaction;

const cache = (over: Partial<ZenCache>): ZenCache => ({
  serverTimestamp: 1,
  instruments: [],
  accounts: [],
  tags: [],
  merchants: [],
  transactions: [],
  user: [],
  ...over,
});

const del = (id: string, object: string) => ({ id, object, user: 1, stamp: 2 });

describe("applyDiff — orphan transaction pruning", () => {
  it("drops a deleted account's transactions even with no per-tx deletion entry", () => {
    const prev = cache({
      accounts: [acc("A"), acc("B")],
      transactions: [txn("t1", "A", "A"), txn("t2", "B", "B")],
    });
    // Incremental diff deletes account B only — Zenmoney doesn't enumerate a
    // deletion for each of B's (old) transactions.
    const diff = {
      serverTimestamp: 2,
      deletion: [del("B", "account")],
    } as ZenDiffResponse;
    const next = applyDiff(prev, diff);
    expect(next.accounts.map((a) => a.id)).toEqual(["A"]);
    expect(next.transactions.map((t) => t.id)).toEqual(["t1"]); // t2 pruned
  });

  it("prunes a transfer when one of its two accounts is gone", () => {
    const prev = cache({
      accounts: [acc("A"), acc("B")],
      transactions: [txn("tr", "A", "B")], // transfer A→B
    });
    const diff = {
      serverTimestamp: 2,
      deletion: [del("B", "account")],
    } as ZenDiffResponse;
    expect(applyDiff(prev, diff).transactions).toHaveLength(0);
  });

  it("keeps transactions whose accounts all still exist", () => {
    const prev = cache({
      accounts: [acc("A")],
      transactions: [txn("t1", "A", "A")],
    });
    const next = applyDiff(prev, { serverTimestamp: 1 } as ZenDiffResponse);
    expect(next.transactions).toHaveLength(1);
  });

  it("prunes orphans on the initial full sync too", () => {
    // prev=null branch: a transaction references an account missing from the diff.
    const diff = {
      serverTimestamp: 1,
      account: [acc("A")],
      transaction: [txn("t1", "A", "A"), txn("t2", "ghost", "ghost")],
    } as ZenDiffResponse;
    const next = applyDiff(null, diff);
    expect(next.transactions.map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("applyDiff — transaction deletions", () => {
  // The push flow folds the deletions IT sent into the merge (the Zenmoney
  // response doesn't echo our own deletions), so the just-deleted rows must
  // drop from the local cache immediately — otherwise they linger as
  // «Удалено» pending until the next full sync.
  it("drops a transaction carried in the diff's `deletion` array", () => {
    const prev = cache({
      accounts: [acc("A")],
      transactions: [txn("t1", "A", "A"), txn("t2", "A", "A")],
    });
    const diff = {
      serverTimestamp: 2,
      deletion: [del("t2", "transaction")],
    } as ZenDiffResponse;
    const next = applyDiff(prev, diff);
    expect(next.transactions.map((t) => t.id)).toEqual(["t1"]);
  });

  it("keeps other rows and just drops the deleted ones", () => {
    const prev = cache({
      accounts: [acc("A")],
      transactions: [txn("t1", "A", "A"), txn("t2", "A", "A"), txn("t3", "A", "A")],
    });
    const diff = {
      serverTimestamp: 2,
      deletion: [del("t1", "transaction"), del("t3", "transaction")],
    } as ZenDiffResponse;
    expect(applyDiff(prev, diff).transactions.map((t) => t.id)).toEqual(["t2"]);
  });
});
