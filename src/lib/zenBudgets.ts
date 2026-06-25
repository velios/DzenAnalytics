// Map Zenmoney «Планы»/budgets (the raw `budget` entities from the diff) into
// a per-(kind, category, month) lookup of planned amounts, so the Budgets page
// can show «план из Дзена» next to our own. This is the PULL side of budget
// sync (read-only): we surface what Zenmoney has, we don't push back yet.
//
// Only MANUAL plans are trusted: a budget counts only when its `*Lock` is true
// (an explicit plan), never the auto-forecast Zenmoney computes for empty cells.
//
// Budgets sit on a tag; we resolve that tag to its TOP-LEVEL category title
// (parent when the tag is a sub-tag) to match our category-by-name model, and
// sum siblings rolling up to the same parent.

import type { ZenBudget, ZenTag } from "./zenmoney";

export type BudgetKind = "expense" | "income";

/** Lookup key for a planned amount. */
export function zenPlanKey(kind: BudgetKind, category: string, ym: string): string {
  return `${kind}:${category}:${ym}`;
}

/**
 * Build a `Map<"kind:category:ym", amount>` of Zenmoney-planned amounts from
 * the cached budgets + tags. Unknown tags, the whole-month aggregate (`tag:
 * null`), unlocked (forecast) values and zero/negative amounts are skipped.
 */
export function zenPlansFromBudgets(
  budgets: ZenBudget[] | undefined,
  tags: ZenTag[] | undefined
): Map<string, number> {
  const out = new Map<string, number>();
  if (!budgets || budgets.length === 0) return out;
  const byId = new Map((tags || []).map((t) => [t.id, t]));

  // Resolve a tag id to its top-level category title (parent's title for a
  // sub-tag, the tag's own title otherwise). null when the tag is unknown.
  const topTitle = (tagId: string): string | null => {
    const t = byId.get(tagId);
    if (!t) return null;
    if (t.parent) {
      const p = byId.get(t.parent);
      return p ? p.title : t.title;
    }
    return t.title;
  };

  const add = (kind: BudgetKind, cat: string, ym: string, amt: number) => {
    const k = zenPlanKey(kind, cat, ym);
    out.set(k, (out.get(k) ?? 0) + amt);
  };

  for (const b of budgets) {
    if (!b.tag) continue; // whole-month aggregate — no category to attach to
    const cat = topTitle(b.tag);
    if (!cat) continue;
    const ym = (b.date || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    if (b.outcomeLock && b.outcome > 0) add("expense", cat, ym, b.outcome);
    if (b.incomeLock && b.income > 0) add("income", cat, ym, b.income);
  }
  return out;
}
