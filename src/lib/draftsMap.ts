// Forward-map locally-created drafts into our internal `Transaction` model
// for display. Drafts are full `ZenTransaction`s but live OUTSIDE the cache
// (they're not cloud truth yet). To render them with identical semantics
// (amountBase, categoryFull, payee, brand, transfer detection), we reuse the
// canonical mapper: feed the cache's reference data (accounts / tags /
// instruments / merchants / user) plus the draft transactions, then keep
// only the mapped draft rows.

import type { Transaction } from "../types";
import type { ZenTransaction } from "./zenmoney";
import type { ZenCache } from "./zenmoneyCache";
import { cacheToDiffResponse } from "./zenmoneyCache";
import { mapZenmoneyDiff } from "./zenmoneyMap";

/**
 * Map draft `ZenTransaction`s to display `Transaction`s using the cache's
 * reference entities. Returns `[]` when there are no drafts or no cache
 * (CSV mode — drafts can't exist there anyway).
 */
export function draftsToTransactions(
  drafts: Record<string, ZenTransaction>,
  cache: ZenCache | null
): Transaction[] {
  const list = Object.values(drafts);
  if (list.length === 0 || !cache) return [];
  const diff = { ...cacheToDiffResponse(cache), transaction: list };
  return mapZenmoneyDiff(diff).transactions;
}
