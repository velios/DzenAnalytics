import { describe, it, expect } from "vitest";
import { buildDeletions } from "./zenmoneyPush";
import type { ZenCache } from "./zenmoneyCache";
import type { ZenTransaction } from "./zenmoney";

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
