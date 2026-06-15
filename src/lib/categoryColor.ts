// Single source of truth for category colours, so the SAME category looks the
// same everywhere (donut, treemap, bars, stream, trends, sankey, dots, drawer).
//
// Priority:
//   1. Zenmoney API tag colour (from `categoryMeta`, decoded in zenmoneyMap.ts);
//   2. a fixed colour for the two synthetic categories (Перевод / Долг);
//   3. a DETERMINISTIC palette colour hashed from the name — stable across
//      sessions and filter changes (unlike the old by-position colouring).

/** Shared fallback palette (also fine as a generic chart palette). */
export const CATEGORY_PALETTE = [
  "#22D3EE", "#A78BFA", "#F59E0B", "#10B981", "#EF4444",
  "#EC4899", "#3B82F6", "#84CC16", "#F97316", "#14B8A6",
  "#8B5CF6", "#06B6D4", "#FBBF24", "#34D399", "#F472B6",
];

/** Local-only synthetic categories the mapper mints (no real Zenmoney tag). */
export const SYNTHETIC_CATEGORY_COLORS: Record<string, string> = {
  Перевод: "#A78BFA",
  Долг: "#64748B",
};

function hashIndex(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % mod;
}

/** Deterministic colour from the name alone — used when there's no API colour.
 *  Stable: the same name always maps to the same palette entry. */
export function fallbackColorForName(name: string): string {
  return SYNTHETIC_CATEGORY_COLORS[name] ?? CATEGORY_PALETTE[hashIndex(name, CATEGORY_PALETTE.length)];
}

/** Resolve a category's colour: API colour first, then the deterministic
 *  fallback. `meta` is the `categoryMeta` map (title → { color }). */
export function colorForCategory(
  name: string,
  meta: Record<string, { color?: string | null } | undefined>
): string {
  return meta[name]?.color || fallbackColorForName(name);
}
