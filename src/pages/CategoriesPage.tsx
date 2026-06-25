import { useMemo, useState } from "react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { ChevronRight, ChevronDown, Maximize2, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useDataStore } from "../store/useDataStore";
import { useThemeStore } from "../store/useThemeStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useFiltersStore, applyFilters, presetToRange } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { affectsExpense, expenseDelta } from "../lib/txKindStyle";
import { colorForCategory, subcategoryColor } from "../lib/categoryColor";
import { formatMoney, formatPct } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { CategoryRequiredEditor } from "../components/CategoryRequiredEditor";
import { CategorySunburst } from "../components/CategorySunburst";
import { CategoryDot } from "../components/CategoryDot";
import { PieChart as PieChartIcon } from "lucide-react";
import type { Transaction } from "../types";

const COLORS = [
  "#22D3EE", "#A78BFA", "#F59E0B", "#10B981", "#EF4444",
  "#EC4899", "#3B82F6", "#84CC16", "#F97316", "#14B8A6",
  "#8B5CF6", "#06B6D4", "#FBBF24", "#34D399", "#F472B6",
];

/**
 * Treemap text colour — uniform across all cells in both themes.
 *
 * We used to flip between black/white per-cell based on the fill's
 * perceived brightness (YIQ), which gave a confused, "patchwork" look.
 * Then we settled on dark-text-on-light / white-text-on-dark, but the
 * dark text on saturated cells (deep blue, pink) was hard to read and
 * felt heavy. Final rule: white text everywhere — the treemap fills
 * are already mid-to-saturated category colours that take a white
 * label cleanly in both themes.
 */
function readableTextOn(_color: string, _theme: "light" | "dark"): string {
  return "#FFFFFF";
}

function truncateToWidth(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return "…";
  return text.slice(0, Math.max(1, maxChars - 1)) + "…";
}

/** Mix a hex colour toward `target` by `t` (0..1). Used to derive opaque
 *  subcategory shades from the parent category colour (so white labels stay
 *  readable, unlike a low fill-opacity). */
function mixHex(hex: string, target: string, t: number): string {
  const parse = (h: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const a = parse(hex);
  const b = parse(target);
  if (!a || !b) return hex;
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${((1 << 24) + (c[0] << 16) + (c[1] << 8) + c[2]).toString(16).slice(1)}`;
}

const TREEMAP_CATS = 24;

interface TreemapLeaf {
  name: string;
  cat: string;
  fullName?: string;
  value: number;
  color: string;
  /** "sub" = a subcategory, "rem" = the category's «без подкатегории» part,
   *  "cat" = a category that has no subcategories at all. Drives the tooltip. */
  level: "sub" | "rem" | "cat";
  // Recharts' TreemapDataType requires an index signature.
  [key: string]: unknown;
}
interface TreemapDatum extends TreemapLeaf {
  children?: TreemapLeaf[];
}

/** Build one nested Treemap node from a category: a leaf when it has no
 *  subcategories, otherwise a container whose children are its subcategory
 *  cells (opaque shades of the parent colour) plus a «без подкатегории»
 *  remainder. Module-level so the data memo stays trivially preservable. */
function buildTreemapNode(
  n: CategoryNode,
  color: string,
  meta: Record<string, { color?: string | null } | undefined>
): TreemapDatum {
  const posSubs = n.subs.filter((s) => s.total > 0);
  if (!posSubs.length) {
    return { name: n.name, cat: n.name, value: n.total, color, level: "cat" };
  }
  const subSum = posSubs.reduce((s, x) => s + x.total, 0);
  const children: TreemapLeaf[] = posSubs.map((sub, idx) => ({
    name: sub.name,
    cat: n.name,
    fullName: sub.fullName,
    value: sub.total,
    // Subcategory's own Zenmoney colour when set; otherwise a shade of the
    // parent so unstyled subs still tile cleanly (issue #17).
    color: subcategoryColor(sub.fullName, meta) || mixHex(color, "#111827", Math.min(0.5, idx * 0.12)),
    level: "sub",
  }));
  const rem = n.total - subSum;
  if (rem > 0.0001) {
    // The «no subcategory» slice is spending tagged to the category itself —
    // label it with the CATEGORY name (not «без подкатегории»).
    children.push({
      name: n.name,
      cat: n.name,
      value: rem,
      color: mixHex(color, "#9ca3af", 0.55),
      level: "rem",
    });
  }
  return { name: n.name, cat: n.name, value: n.total, color, level: "cat", children };
}

/** A computed Treemap node (Recharts spreads the data fields onto it). */
interface TreemapNodeView {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  depth?: number;
  index?: number;
  name?: string;
  value?: number;
  color?: string;
  cat?: string;
  fullName?: string;
  children?: unknown;
}

function TreemapCell({
  node,
  base,
  theme,
}: {
  node: TreemapNodeView;
  base: string;
  theme: "light" | "dark";
}) {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const width = node.width ?? 0;
  const height = node.height ?? 0;
  const name = node.name ?? "";
  const value = node.value ?? 0;
  if (width < 1 || height < 1) return <g />;

  // A node with children is a CATEGORY container: its subcategory cells tile
  // it completely, so we only draw a thicker frame to group them visually.
  const kids = node.children;
  if (Array.isArray(kids) && kids.length > 0) {
    return (
      <rect
        x={Math.round(x)}
        y={Math.round(y)}
        width={Math.round(width)}
        height={Math.round(height)}
        rx={5}
        fill="none"
        stroke="rgb(var(--c-bg))"
        strokeWidth={3.5}
      />
    );
  }

  // Leaf cell — a subcategory, or a category without subcategories.
  const fill = node.color || "#22D3EE";
  const textColor = readableTextOn(fill, theme);
  const subColor =
    textColor === "#FFFFFF" ? "rgba(255,255,255,0.78)" : "rgba(11,17,32,0.72)";

  // Compact, more uniform tiering. Earlier 13/12/11 sizes made bigger
  // cells feel "shouty" and inconsistent with neighbours; this scheme
  // keeps the spread inside a tight 11/10/9 band so the label visually
  // anchors the cell without dominating it.
  const tier =
    width >= 140 && height >= 60
      ? "lg"
      : width >= 80 && height >= 40
        ? "md"
        : width >= 40 && height >= 24
          ? "sm"
          : "xs";

  const titleSize = tier === "lg" ? 11 : tier === "md" ? 11 : tier === "sm" ? 10 : 9;
  const charPx = titleSize * 0.55;
  const padX = tier === "xs" ? 4 : 6;
  const maxChars = Math.max(1, Math.floor((width - padX * 2) / charPx));
  const label = truncateToWidth(name, maxChars);

  const showAmount = tier !== "xs" && height >= titleSize * 2 + 6;
  const amountText = formatMoney(value, base, { compact: true });
  const amountSize = tier === "lg" ? 10 : 10;
  const amountChars = Math.max(1, Math.floor((width - padX * 2) / (amountSize * 0.55)));
  const amount = truncateToWidth(amountText, amountChars);

  // Round all SVG coordinates to whole pixels. Recharts gives us floats
  // from its layout pass; combined with the body-level
  // `text-rendering: optimizeLegibility`, sub-pixel anchors produce a
  // ghosted / haloed look on `<text>` elements ("each glyph rendered with
  // a faint outline"). Snapping to integer pixels makes glyphs land on
  // exact device pixels and removes the artefact.
  const rx = Math.round(x);
  const ry = Math.round(y);
  const rw = Math.round(width);
  const rh = Math.round(height);
  const titleX = Math.round(rx + padX);
  const titleY = Math.round(ry + titleSize + 4);
  const amountX = titleX;
  const amountY = Math.round(ry + titleSize + amountSize + 8);

  // Common SVG-text props that:
  //   • disable inherited `stroke` (Recharts can propagate the parent
  //     <Treemap stroke> to children — would draw a 2px outline AROUND
  //     each glyph, the second source of the "double-rendered" look);
  //   • switch text-rendering to `geometricPrecision` so SVG ignores the
  //     body's `optimizeLegibility` that triggers fractional-pixel
  //     anti-aliasing inside <text>.
  const textBase = {
    stroke: "none",
    style: {
      pointerEvents: "none" as const,
      textRendering: "geometricPrecision" as const,
    },
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  };

  return (
    <g style={{ cursor: "pointer" }}>
      <rect
        x={rx}
        y={ry}
        width={rw}
        height={rh}
        rx={3}
        fill={fill}
        stroke="rgb(var(--c-bg))"
        strokeWidth={2}
      />
      <text
        x={titleX}
        y={titleY}
        fill={textColor}
        fontSize={titleSize}
        fontWeight={500}
        {...textBase}
      >
        {label}
      </text>
      {showAmount && (
        <text
          x={amountX}
          y={amountY}
          fill={subColor}
          fontSize={amountSize}
          {...textBase}
        >
          {amount}
        </text>
      )}
    </g>
  );
}

type View = "rings" | "treemap" | "bars";

interface SubNode {
  name: string;
  fullName: string;
  total: number;
  count: number;
}
interface CategoryNode {
  name: string;
  total: number;
  count: number;
  subs: SubNode[];
}

function buildHierarchy(txs: Transaction[], kind: "expense" | "income"): CategoryNode[] {
  const map = new Map<string, CategoryNode>();
  for (const t of txs) {
    // For the expense view, include refunds (signed negative) so a
    // returned purchase shrinks the category's bar in the hierarchy.
    // Income view stays strict — refunds are not income.
    const include = kind === "expense" ? affectsExpense(t.kind) : t.kind === kind;
    if (!include) continue;
    const delta = kind === "expense" ? expenseDelta(t) : t.amountBase;
    let node = map.get(t.category);
    if (!node) {
      node = { name: t.category, total: 0, count: 0, subs: [] };
      map.set(t.category, node);
    }
    node.total += delta;
    node.count++;
    if (t.subcategory) {
      let sub = node.subs.find((s) => s.name === t.subcategory);
      if (!sub) {
        sub = { name: t.subcategory, fullName: t.categoryFull, total: 0, count: 0 };
        node.subs.push(sub);
      }
      sub.total += delta;
      sub.count++;
    }
  }
  for (const node of map.values()) {
    node.subs.sort((a, b) => b.total - a.total);
  }
  // Drop categories that fully cancel out (sum exactly 0); but keep
  // negative ones — those are a useful flag that "категория ушла
  // в минус из-за возвратов" and the user might want to look.
  return Array.from(map.values())
    .filter((n) => n.total !== 0)
    .sort((a, b) => b.total - a.total);
}

export function CategoriesPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const theme = useThemeStore((s) => s.resolved);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const metaLoaded = useCategoryMetaStore((s) => s.loaded);
  const hydrateMeta = useCategoryMetaStore((s) => s.hydrate);
  useEffect(() => {
    if (!metaLoaded) hydrateMeta();
  }, [metaLoaded, hydrateMeta]);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  const [view, setView] = useState<View>("rings");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const showDrill = useDrillStore((s) => s.show);

  const filtered = useMemo(() => applyFilters(transactions, filters, monthStartDay), [transactions, filters, monthStartDay]);
  const tree = useMemo(() => buildHierarchy(filtered, kind), [filtered, kind]);

  // Single source of truth for "what colour belongs to this category".
  // Donut / Treemap / Bars all consult this map. Zenmoney's
  // `tag.color` wins; otherwise a DETERMINISTIC colour from the name (shared
  // `colorForCategory`), so the same category matches every other page.
  const resolvedCategoryColors = useMemo(() => {
    const m: Record<string, string> = {};
    for (const node of tree) m[node.name] = colorForCategory(node.name, categoryMeta);
    return m;
  }, [tree, categoryMeta]);

  const totalAll = tree.reduce((s, n) => s + n.total, 0);
  const kindWord = kind === "expense" ? "Расходы" : "Доходы";

  // «Год назад» comparison (Bars view): the SAME calendar window shifted back
  // exactly one year, with every other filter (accounts / categories /
  // currencies / search) preserved. Maps category & subcategory → its total a
  // year ago, so the Bars list can show a year-over-year column. Only defined
  // when the current selection has explicit bounds (preset «Всё» / open custom
  // ranges have no analogous «year ago» window).
  const prevYear = useMemo(() => {
    const maxDate = transactions.reduce((m, t) => (t.date > m ? t.date : m), "");
    const curRange =
      filters.preset === "custom"
        ? { from: filters.from, to: filters.to }
        : presetToRange(filters.preset, maxDate, filters.monthYM, monthStartDay);
    const shift = (d: string | null): string | null => {
      if (!d) return null;
      const dt = new Date(d);
      dt.setFullYear(dt.getFullYear() - 1);
      return dt.toISOString().slice(0, 10);
    };
    const from = shift(curRange.from);
    const to = shift(curRange.to);
    const comparable = !!(from && to);
    if (!comparable) {
      return { comparable, cat: new Map<string, number>(), sub: new Map<string, number>() };
    }
    const prevTxs = applyFilters(
      transactions,
      { ...filters, preset: "custom", from, to },
      monthStartDay
    );
    const prevTree = buildHierarchy(prevTxs, kind);
    const cat = new Map<string, number>();
    const sub = new Map<string, number>();
    for (const n of prevTree) {
      cat.set(n.name, n.total);
      for (const s of n.subs) sub.set(s.fullName, s.total);
    }
    return { comparable, cat, sub };
  }, [transactions, filters, monthStartDay, kind]);

  // «Дельта» pill — change versus the same period a year ago. Colour is
  // semantic: for expenses a rise is «bad» (red) and a drop «good» (green);
  // for income it's the other way round. «новое» when there was nothing a
  // year ago, «—» when the period has no comparable year-ago window.
  function deltaPill(cur: number, prev: number | undefined) {
    if (!prevYear.comparable) return <span className="text-muted">—</span>;
    if (prev === undefined || prev <= 0) {
      return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs text-muted bg-panel2">
          Новое
        </span>
      );
    }
    const d = Math.round(((cur - prev) / prev) * 100);
    if (d === 0) return <span className="text-xs text-muted tabular-nums">0%</span>;
    const up = d > 0;
    const good = kind === "expense" ? !up : up;
    const cls = good ? "text-income bg-income/10" : "text-expense bg-expense/10";
    return (
      <span
        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs tabular-nums ${cls}`}
      >
        {up ? "▲" : "▼"} {up ? "+" : "−"}
        {Math.abs(d)}%
      </span>
    );
  }

  // Category lookup by name — shared by the «Все категории» bar tooltip and
  // the treemap tooltip below.
  const catByName = useMemo(() => {
    const m = new Map<string, CategoryNode>();
    for (const n of tree) m.set(n.name, n);
    return m;
  }, [tree]);

  // Treemap tooltip — info about the HOVERED cell itself: a subcategory shows
  // its share of the category; a category-level cell its share of the total.
  function renderTreemapTooltip(props: {
    active?: boolean;
    payload?: readonly {
      payload?: { name?: string; cat?: string; value?: number; level?: string };
    }[];
  }) {
    if (!props.active || !props.payload?.length) return null;
    const p = props.payload[0]?.payload;
    if (!p?.name) return null;
    const value = p.value ?? 0;
    const ofCategory = p.level === "sub" || p.level === "rem";
    const denom = ofCategory ? catByName.get(p.cat ?? "")?.total ?? 0 : totalAll;
    const share = denom ? value / denom : 0;
    return (
      <div className="rounded-lg border border-border bg-panel shadow-lg px-3 py-2 text-sm max-w-[260px]">
        <div className="font-medium">{p.name}</div>
        <div className="text-muted">
          {formatMoney(value, base)} ({formatPct(share, 1)}
          {ofCategory && p.level === "sub" ? ` от «${p.cat}»` : ""})
        </div>
      </div>
    );
  }

  // Fullscreen treemap (the «Карта категорий» can be cramped in the card).
  const [treemapFull, setTreemapFull] = useState(false);
  useEffect(() => {
    if (!treemapFull) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTreemapFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [treemapFull]);

  function onTreemapClick(node: { fullName?: string; cat?: string; name?: string } | undefined) {
    if (node?.fullName) openSubcategory(node.fullName);
    else if (node?.cat) openCategory(node.cat);
    else if (node?.name) openCategory(node.name);
  }

  function renderTreemap() {
    return (
      <ResponsiveContainer>
        <Treemap
          data={treemapData}
          dataKey="value"
          stroke="rgb(var(--c-bg))"
          isAnimationActive={false}
          onClick={(node: { fullName?: string; cat?: string; name?: string }) =>
            onTreemapClick(node)
          }
          content={(node: TreemapNodeView) => (
            <TreemapCell node={node} base={base} theme={theme} />
          )}
        >
          <Tooltip
            content={renderTreemapTooltip}
            isAnimationActive={false}
            wrapperStyle={{ zIndex: 50 }}
          />
        </Treemap>
      </ResponsiveContainer>
    );
  }

  // Treemap «Карта категорий»: nested — categories subdivided into their
  // subcategory cells (opaque shades of the parent colour) + a «без
  // подкатегории» remainder. Categories without subs stay single cells.
  // Plain computation (no useMemo) — the React Compiler auto-memoizes it, and
  // a manual memo around the helper call can't be statically preserved.
  const treemapData = tree
    .filter((n) => n.total > 0)
    .slice(0, TREEMAP_CATS)
    .map((n) => buildTreemapNode(n, resolvedCategoryColors[n.name] || COLORS[0], categoryMeta));

  function openCategory(name: string) {
    // When drilling into an expense category, also show refunds tagged
    // with that category — they're what shrank the total the user just
    // clicked on, so it'd be confusing to hide them.
    const matches = (t: Transaction) =>
      (kind === "expense" ? affectsExpense(t.kind) : t.kind === kind) && t.category === name;
    const txs = filtered.filter(matches);
    showDrill(name, txs, kind === "expense" ? "Расходы по категории" : "Доходы по категории");
  }
  function openSubcategory(fullName: string) {
    const matches = (t: Transaction) =>
      (kind === "expense" ? affectsExpense(t.kind) : t.kind === kind) &&
      t.categoryFull === fullName;
    const txs = filtered.filter(matches);
    showDrill(
      fullName,
      txs,
      kind === "expense" ? "Расходы по подкатегории" : "Доходы по подкатегории"
    );
  }
  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  function expandAll() {
    setExpanded(new Set(tree.filter((n) => n.subs.length > 0).map((n) => n.name)));
  }
  function collapseAll() {
    setExpanded(new Set());
  }

  if (transactions.length === 0) return <EmptyState />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={PieChartIcon}
        title="Категории"
        hint="Данные и аналитика с разбивкой по категориям и подкатегориям. Клик по элементу — список операций."
        right={
          <div className="flex flex-wrap gap-2">
            <div className="flex bg-panel2 rounded-lg p-1 border border-border">
              <button
                onClick={() => setKind("expense")}
                className={`px-3 py-1 text-xs rounded-md ${kind === "expense" ? "bg-expense text-white" : "text-muted"}`}
              >
                Расходы
              </button>
              <button
                onClick={() => setKind("income")}
                className={`px-3 py-1 text-xs rounded-md ${kind === "income" ? "bg-income text-white" : "text-muted"}`}
              >
                Доходы
              </button>
            </div>
            <div className="flex bg-panel2 rounded-lg p-1 border border-border">
              <button
                onClick={() => setView("rings")}
                className={`px-3 py-1 text-xs rounded-md ${view === "rings" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                Donut
              </button>
              <button
                onClick={() => setView("bars")}
                className={`px-3 py-1 text-xs rounded-md ${view === "bars" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                Bars
              </button>
              <button
                onClick={() => setView("treemap")}
                className={`px-3 py-1 text-xs rounded-md ${view === "treemap" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                Treemap
              </button>
            </div>
          </div>
        }
      />
      <GlobalFilters />

      <div>
        <div className="card card-pad">
          {/* Shared header for the Treemap / Bars views — mirrors the Donut's
              own header (kind badge + scope + big total) so all three read as
              one family. Donut carries its own header, so this is hidden there. */}
          {view !== "rings" && (
            <div className="mb-4 flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full text-white ${
                      kind === "expense" ? "bg-expense" : "bg-income"
                    }`}
                  >
                    {kindWord}
                  </span>
                  <span className="text-sm text-muted">Все категории</span>
                </div>
                <div className="text-3xl font-bold tabular-nums">
                  {formatMoney(totalAll, base)}
                </div>
              </div>
              {view === "treemap" && (
                <button
                  onClick={() => setTreemapFull(true)}
                  className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent shrink-0 mt-1"
                  title="Открыть на весь экран"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  На весь экран
                </button>
              )}
              {view === "bars" &&
                (() => {
                  const expandable = tree.filter((n) => n.subs.some((s) => s.total > 0));
                  const allExpanded =
                    expandable.length > 0 && expandable.every((n) => expanded.has(n.name));
                  return (
                    <button
                      onClick={() => (allExpanded ? collapseAll() : expandAll())}
                      title={allExpanded ? "Свернуть все" : "Развернуть все"}
                      aria-label={allExpanded ? "Свернуть все" : "Развернуть все"}
                      className="inline-flex items-center justify-center shrink-0 mt-1 w-8 h-8 rounded-md border border-border text-muted hover:text-accent hover:border-accent"
                    >
                      <ChevronDown
                        className={`w-4 h-4 transition-transform duration-300 ${
                          allExpanded ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  );
                })()}
            </div>
          )}
          {view === "rings" && (
            <CategorySunburst
              data={tree}
              meta={categoryMeta}
              base={base}
              kind={kind}
              onOpenCategory={openCategory}
              onOpenSubcategory={openSubcategory}
            />
          )}
          {view === "treemap" && (
            <div className="h-[450px] relative">{renderTreemap()}</div>
          )}
          {view === "bars" && (
            <div
              className="overflow-y-auto pr-1 max-h-[560px]"
              style={{ scrollbarGutter: "stable" }}
            >
              {/* Column header — same shape & widths as the Donut legend so the
                  two views feel identical. */}
              <div className="sticky top-0 z-10 bg-panel flex items-center gap-2 px-1.5 pb-1 mb-1 border-b border-border text-[11px] text-muted uppercase tracking-wide">
                <span className="flex-1 min-w-0">Категория</span>
                <span className="w-14 text-left shrink-0">%</span>
                <span className="w-20 text-left shrink-0">Операции</span>
                <span className="w-28 text-left shrink-0">Сумма</span>
                <span
                  className="w-28 text-left shrink-0"
                  title="Та же сумма за этот же период годом ранее"
                >
                  Год назад
                </span>
                <span
                  className="w-24 text-left shrink-0"
                  title="Изменение к тому же периоду год назад: рост или снижение в процентах"
                >
                  Дельта
                </span>
                <span className="w-5 shrink-0" />
              </div>
              <div className="space-y-0.5">
                {tree.map((node) => {
                  const color = resolvedCategoryColors[node.name] || COLORS[0];
                  const isOpen = expanded.has(node.name);
                  const hasSubs = node.subs.some((s) => s.total > 0);
                  // Bars share ONE scale that also covers the «year ago» values,
                  // so a year-ago marker always lands inside the track.
                  const maxTotal = Math.max(
                    tree[0]?.total || 1,
                    ...tree.map((n) => prevYear.cat.get(n.name) || 0)
                  );
                  const barPct = Math.max(0, (node.total / maxTotal) * 100);
                  const prevCat = prevYear.cat.get(node.name);
                  return (
                    <div key={node.name}>
                      <div
                        className="flex items-center gap-2 px-1.5 py-1.5 rounded-md hover:bg-panel2/50 cursor-pointer"
                        onClick={() => openCategory(node.name)}
                      >
                        <CategoryDot category={node.name} size="w-7 h-7" />
                        <div className="flex-1 min-w-0">
                          <div className="text-base truncate" title={node.name}>
                            {node.name}
                          </div>
                          <div className="relative h-2 mt-1">
                            <div className="absolute inset-0 bg-panel2 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${barPct}%`, background: color }}
                              />
                            </div>
                            {prevCat !== undefined && (
                              <div
                                className="absolute top-1/2 -translate-y-1/2 w-0 border-l-2 border-dashed border-text/70"
                                style={{
                                  left: `${Math.min(100, (prevCat / maxTotal) * 100)}%`,
                                  height: "175%",
                                }}
                                title={`Год назад: ${formatMoney(prevCat, base)}`}
                              />
                            )}
                          </div>
                        </div>
                        <span className="w-14 text-left text-sm text-muted tabular-nums shrink-0">
                          {formatPct(node.total / totalAll, 1)}
                        </span>
                        <span className="w-20 text-left text-sm text-muted tabular-nums shrink-0">
                          {node.count}
                        </span>
                        <span className="w-28 text-left text-base tabular-nums shrink-0">
                          {formatMoney(node.total, base)}
                        </span>
                        <span className="w-28 text-left text-sm text-muted tabular-nums shrink-0">
                          {prevYear.cat.has(node.name)
                            ? formatMoney(prevYear.cat.get(node.name)!, base)
                            : "—"}
                        </span>
                        <span className="w-24 text-left shrink-0">
                          {deltaPill(node.total, prevYear.cat.get(node.name))}
                        </span>
                        <span className="w-5 shrink-0 flex items-center justify-center">
                          {hasSubs && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand(node.name);
                              }}
                              className="text-muted hover:text-accent"
                              title={isOpen ? "Свернуть" : "Подкатегории"}
                            >
                              {isOpen ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </button>
                          )}
                        </span>
                      </div>

                      {isOpen && hasSubs && (
                        <div className="mb-1 space-y-0.5">
                          {node.subs
                            .filter((s) => s.total > 0)
                            .map((sub, idx) => {
                              const own = subcategoryColor(sub.fullName, categoryMeta);
                              const subColor = own || color;
                              const subOpacity = own ? 1 : Math.max(0.4, 1 - idx * 0.12);
                              return (
                                <div
                                  key={sub.fullName}
                                  className="flex items-center gap-2 px-1.5 py-1.5 rounded-md hover:bg-panel2/50 cursor-pointer"
                                  onClick={() => openSubcategory(sub.fullName)}
                                >
                                  {/* Full-size icon badge (own icon/colour, else
                                      parent's), indented to read as a child. */}
                                  <span className="pl-3 shrink-0">
                                    <CategoryDot
                                      category={sub.name}
                                      parent={node.name}
                                      fallback={subColor}
                                      size="w-6 h-6"
                                    />
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-base truncate text-muted">{sub.name}</div>
                                    <div className="relative h-1.5 mt-1">
                                      <div className="absolute inset-0 bg-panel2 rounded-full overflow-hidden">
                                        <div
                                          className="h-full rounded-full"
                                          style={{
                                            width: `${Math.max(0, (sub.total / maxTotal) * 100)}%`,
                                            background: subColor,
                                            opacity: subOpacity,
                                          }}
                                        />
                                      </div>
                                      {prevYear.sub.get(sub.fullName) !== undefined && (
                                        <div
                                          className="absolute top-1/2 -translate-y-1/2 w-0 border-l-2 border-dashed border-text/60"
                                          style={{
                                            left: `${Math.min(100, (prevYear.sub.get(sub.fullName)! / maxTotal) * 100)}%`,
                                            height: "200%",
                                          }}
                                          title={`Год назад: ${formatMoney(prevYear.sub.get(sub.fullName)!, base)}`}
                                        />
                                      )}
                                    </div>
                                  </div>
                                  <span className="w-14 text-left text-sm text-muted tabular-nums shrink-0">
                                    {formatPct(sub.total / totalAll, 1)}
                                  </span>
                                  <span className="w-20 text-left text-sm text-muted tabular-nums shrink-0">
                                    {sub.count}
                                  </span>
                                  <span className="w-28 text-left text-base tabular-nums shrink-0">
                                    {formatMoney(sub.total, base)}
                                  </span>
                                  <span className="w-28 text-left text-sm text-muted tabular-nums shrink-0">
                                    {prevYear.sub.has(sub.fullName)
                                      ? formatMoney(prevYear.sub.get(sub.fullName)!, base)
                                      : "—"}
                                  </span>
                                  <span className="w-24 text-left shrink-0">
                                    {deltaPill(sub.total, prevYear.sub.get(sub.fullName))}
                                  </span>
                                  <span className="w-5 shrink-0" />
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <CategoryRequiredEditor />

      {treemapFull &&
        createPortal(
          <div className="fixed inset-0 z-[90] bg-panel flex flex-col p-4">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className="font-semibold">
                Карта категорий
                <span className="text-muted font-normal text-sm ml-2">
                  {kind === "expense" ? "расходы" : "доходы"} · {formatMoney(totalAll, base)}
                </span>
              </div>
              <button
                onClick={() => setTreemapFull(false)}
                className="btn-ghost text-sm"
                title="Закрыть (Esc)"
              >
                <X className="w-4 h-4" />
                Закрыть
              </button>
            </div>
            <div className="flex-1 min-h-0">{renderTreemap()}</div>
          </div>,
          document.body
        )}
    </div>
  );
}
