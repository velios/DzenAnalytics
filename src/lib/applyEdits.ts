import type { Transaction, CurrencyRates } from "../types";
import type { TransactionEdit } from "../store/useEditsStore";
import { toBase } from "./csv";

/**
 * Apply per-id user edits on top of an already post-processed transaction
 * array. Recomputes `amountBase` when amount/currency changes so all charts
 * stay consistent. The `id` is preserved untouched.
 */
export function applyEdits(
  txs: Transaction[],
  edits: Record<string, TransactionEdit>,
  rates: CurrencyRates
): Transaction[] {
  if (!edits || Object.keys(edits).length === 0) return txs;
  return txs.map((t) => {
    const patch = edits[t.id];
    if (!patch) return t;
    const merged: Transaction = { ...t, ...patch };
    // If subcategory or category changed, keep categoryFull in sync unless
    // user explicitly provided their own.
    if (patch.category || patch.subcategory) {
      const cat = patch.category ?? merged.category;
      const sub = patch.subcategory ?? merged.subcategory;
      const full =
        patch.categoryFull ?? (sub ? `${cat} / ${sub}` : cat);
      merged.category = cat;
      merged.subcategory = sub;
      merged.categoryFull = full;
    }
    // A flip TO transfer drops the old category — a transfer between the user's
    // own accounts has no real spending/income category. Label it "Перевод"
    // (synthetic, matches the forward mapper). Only triggered when the edit
    // itself changed the kind to transfer, so mapper-native "Долг" rows (debt
    // transfers, no kind patch) keep their "Долг" label.
    if (patch.kind === "transfer") {
      merged.category = "Перевод";
      merged.subcategory = null;
      merged.categoryFull = "Перевод";
    }
    // Recompute base amount only if amount or currency changed.
    if (patch.amount !== undefined || patch.currency !== undefined) {
      merged.amountBase = toBase(merged.amount, merged.currency, rates);
    }
    return merged;
  });
}
