// Map Zenmoney «Планы» (the raw `budget` entities from the diff — historically
// named `budget` in the API) into per-(kind, category, subcategory, month)
// planned amounts, so the Budgets page can show «план из Дзена» and sync.
//
// Per-tag, 1:1: each Zenmoney budget sits on exactly ONE tag and we keep it that
// way — a top-level tag → (category, subcategory=null); a sub-tag → (parent
// title, sub title). We DON'T roll sub-tags up to their parent and DON'T sum
// siblings, so the mapping stays reversible (needed for push-back).
//
// Only MANUAL plans are trusted: a budget counts only when it is NOT an
// auto-forecast (`isOutcomeForecast`/`isIncomeForecast` false) — never the
// `*Lock` flag, which real manual plans leave `false`.

import type { ZenBudget, ZenTag } from "./zenmoney";

export type BudgetKind = "expense" | "income";

/** A single Zenmoney plan, resolved to our category model, for one month. */
export interface ZenPlanEntry {
  kind: BudgetKind;
  category: string;
  /** Sub-category title, or null when the plan is on the parent tag itself. */
  subcategory: string | null;
  ym: string; // "YYYY-MM"
  amount: number;
}

// NUL separator — safe because tag titles never contain it, unlike ":".
const SEP = "\u0000";

/** Lookup key for a planned amount (per tag, per month). */
export function zenPlanKey(
  kind: BudgetKind,
  category: string,
  subcategory: string | null,
  ym: string
): string {
  return [kind, category, subcategory ?? "", ym].join(SEP);
}

// The whole-month aggregate carries no category: `tag: null` OR the all-zeros
// UUID. Both must be skipped.
const NULL_TAG = "00000000-0000-0000-0000-000000000000";

/**
 * Resolve a tag id to `{category, subcategory}`: a sub-tag → its parent's title
 * + own title; a top-level tag → own title + null. `null` when tag is unknown.
 */
function resolveTag(
  tagId: string,
  byId: Map<string, ZenTag>
): { category: string; subcategory: string | null } | null {
  const t = byId.get(tagId);
  if (!t) return null;
  if (t.parent) {
    const p = byId.get(t.parent);
    // Orphan sub-tag (parent missing) → treat as its own top-level category.
    return p
      ? { category: p.title, subcategory: t.title }
      : { category: t.title, subcategory: null };
  }
  return { category: t.title, subcategory: null };
}

/**
 * Flatten the cached budgets + tags into a list of per-tag plan entries.
 * Unknown tags, the whole-month aggregate, auto-forecast values and
 * zero/negative amounts are skipped.
 */
export function zenPlanList(
  budgets: ZenBudget[] | undefined,
  tags: ZenTag[] | undefined
): ZenPlanEntry[] {
  const out: ZenPlanEntry[] = [];
  if (!budgets || budgets.length === 0) return out;
  const byId = new Map((tags || []).map((t) => [t.id, t]));

  for (const b of budgets) {
    if (!b.tag || b.tag === NULL_TAG) continue;
    const r = resolveTag(b.tag, byId);
    if (!r) continue;
    const ym = (b.date || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    // A REAL (user-set) plan is one Zenmoney did NOT auto-forecast.
    if (!b.isOutcomeForecast && b.outcome > 0)
      out.push({ kind: "expense", ...r, ym, amount: b.outcome });
    if (!b.isIncomeForecast && b.income > 0)
      out.push({ kind: "income", ...r, ym, amount: b.income });
  }
  return out;
}

/**
 * Build a `Map<key, amount>` of Zenmoney-planned amounts for quick lookup on
 * the Budgets page. Key = {@link zenPlanKey}.
 */
export function zenPlansFromBudgets(
  budgets: ZenBudget[] | undefined,
  tags: ZenTag[] | undefined
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of zenPlanList(budgets, tags)) {
    out.set(zenPlanKey(e.kind, e.category, e.subcategory, e.ym), e.amount);
  }
  return out;
}
