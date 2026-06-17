// Local cache of the Zenmoney "world" between syncs.
//
// We keep a snapshot of every raw entity (instruments, accounts, tags,
// merchants, transactions, user) so that incremental diffs can be merged
// in: the server only returns CHANGED entities since the last sync, but
// our mapper needs the FULL set to produce a complete Transaction[].
//
// The whole snapshot lives under one IndexedDB key as a single JSON blob.
// For typical Zenmoney accounts (~10k transactions + a few hundred refs)
// that's ~5 MB — well within IDB limits and trivial to read/write.

import * as db from "./db";
import type {
  ZenAccount,
  ZenDeletion,
  ZenDiffResponse,
  ZenInstrument,
  ZenMerchant,
  ZenTag,
  ZenTransaction,
} from "./zenmoney";

const CACHE_KEY = "zenmoneyCache";

export interface ZenCache {
  serverTimestamp: number;
  instruments: ZenInstrument[];
  accounts: ZenAccount[];
  tags: ZenTag[];
  merchants: ZenMerchant[];
  transactions: ZenTransaction[];
  user: ZenDiffResponse["user"];
}

export async function loadZenCache(): Promise<ZenCache | null> {
  return db.loadJSON<ZenCache>(CACHE_KEY);
}

export async function saveZenCache(cache: ZenCache): Promise<void> {
  await db.saveJSON(CACHE_KEY, cache);
}

export async function clearZenCache(): Promise<void> {
  await db.saveJSON(CACHE_KEY, null);
}

function dedupBy<T, K>(arr: T[], key: (t: T) => K): T[] {
  // Keep last occurrence so incoming wins when ids collide.
  const map = new Map<K, T>();
  for (const item of arr) map.set(key(item), item);
  return Array.from(map.values());
}

function applyDeletions<T extends { id: string | number }>(
  items: T[],
  objectType: string,
  deletions: ZenDeletion[]
): T[] {
  if (deletions.length === 0) return items;
  const toDelete = new Set(
    deletions.filter((d) => d.object === objectType).map((d) => String(d.id))
  );
  if (toDelete.size === 0) return items;
  return items.filter((it) => !toDelete.has(String(it.id)));
}

function merge<T extends { id: string | number }>(
  prev: T[],
  incoming: T[] | undefined,
  objectType: string,
  deletions: ZenDeletion[]
): T[] {
  // 1. Drop deleted ids from previous state.
  // 2. Append incoming and dedup by id (incoming wins thanks to Map order).
  // The API may omit entity sections entirely when nothing changed.
  const after = applyDeletions(prev, objectType, deletions);
  const inc = incoming || [];
  if (inc.length === 0 && deletions.every((d) => d.object !== objectType)) {
    return prev; // hot path: no changes for this entity type
  }
  return dedupBy([...after, ...inc], (it) => it.id);
}

/**
 * Drop transactions that reference an account no longer present in the cache.
 *
 * When an account is deleted in Zenmoney, the incremental diff reliably removes
 * the *account* but doesn't always enumerate a `deletion` entry for each of its
 * (often old) transactions — so those linger as orphans. Their balances/charts
 * re-anchor to the live accounts and drop, but raw flow sums (Поступления/
 * Списания) keep counting the orphans. Pruning here keeps the cache internally
 * consistent and self-heals on the very next sync.
 */
function pruneOrphanTransactions(cache: ZenCache): ZenCache {
  const accountIds = new Set(cache.accounts.map((a) => String(a.id)));
  const transactions = cache.transactions.filter((t) =>
    [t.incomeAccount, t.outcomeAccount]
      .filter((a) => a != null && a !== "")
      .every((a) => accountIds.has(String(a)))
  );
  return transactions.length === cache.transactions.length
    ? cache
    : { ...cache, transactions };
}

/**
 * Apply a server diff onto the previous cache, returning a fresh cache.
 * If `prev` is null this is the initial full sync result.
 */
export function applyDiff(
  prev: ZenCache | null,
  diff: ZenDiffResponse
): ZenCache {
  if (!prev) {
    // Empty / very-new accounts can come back from the API with whole
    // sections missing (the field is just absent rather than `[]`).
    // Default each to an empty array so downstream code can always
    // iterate without an `is not iterable` runtime error.
    return pruneOrphanTransactions({
      serverTimestamp: diff.serverTimestamp,
      instruments: diff.instrument || [],
      accounts: diff.account || [],
      tags: diff.tag || [],
      merchants: diff.merchant || [],
      transactions: diff.transaction || [],
      user: diff.user || [],
    });
  }
  const deletions = diff.deletion || [];
  return pruneOrphanTransactions({
    serverTimestamp: diff.serverTimestamp,
    instruments: merge(prev.instruments, diff.instrument, "instrument", deletions),
    accounts: merge(prev.accounts, diff.account, "account", deletions),
    tags: merge(prev.tags, diff.tag, "tag", deletions),
    merchants: merge(prev.merchants, diff.merchant, "merchant", deletions),
    transactions: merge(
      prev.transactions,
      diff.transaction,
      "transaction",
      deletions
    ),
    // user record rarely changes; if diff omits it, keep previous.
    user: diff.user && diff.user.length > 0 ? diff.user : prev.user,
  });
}

/**
 * Turn a cache back into the diff-shaped object expected by `mapZenmoneyDiff`.
 */
export function cacheToDiffResponse(cache: ZenCache): ZenDiffResponse {
  return {
    serverTimestamp: cache.serverTimestamp,
    instrument: cache.instruments,
    account: cache.accounts,
    tag: cache.tags,
    merchant: cache.merchants,
    transaction: cache.transactions,
    user: cache.user,
  };
}
