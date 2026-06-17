import { useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Treemap,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { ChevronRight, ChevronLeft, ChevronDown, Lock, Coffee, Maximize2, X } from "lucide-react";
import clsx from "clsx";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useDataStore } from "../store/useDataStore";
import { useThemeStore } from "../store/useThemeStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { useCategoryFlagsStore } from "../store/useCategoryFlagsStore";
import { affectsExpense, expenseDelta } from "../lib/txKindStyle";
import { colorForCategory } from "../lib/categoryColor";
import {
  formatMoney,
  formatNum,
  formatPct,
  chartGridStroke,
  chartAxisStroke,
} from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { CategoryRequiredEditor } from "../components/CategoryRequiredEditor";
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
function buildTreemapNode(n: CategoryNode, color: string): TreemapDatum {
  const posSubs = n.subs.filter((s) => s.total > 0);
  if (!posSubs.length) return { name: n.name, cat: n.name, value: n.total, color };
  const subSum = posSubs.reduce((s, x) => s + x.total, 0);
  const children: TreemapLeaf[] = posSubs.map((sub, idx) => ({
    name: sub.name,
    cat: n.name,
    fullName: sub.fullName,
    value: sub.total,
    color: mixHex(color, "#111827", Math.min(0.5, idx * 0.12)),
  }));
  const rem = n.total - subSum;
  if (rem > 0.0001) {
    children.push({
      name: "Без подкатегории",
      cat: n.name,
      value: rem,
      color: mixHex(color, "#9ca3af", 0.55),
    });
  }
  return { name: n.name, cat: n.name, value: n.total, color, children };
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
      <title>{`${name} · ${amountText}`}</title>
      <rect
        x={rx}
        y={ry}
        width={rw}
        height={rh}
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

type View = "donut" | "treemap";

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

  const [view, setView] = useState<View>("donut");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const showDrill = useDrillStore((s) => s.show);
  const flags = useCategoryFlagsStore((s) => s.flags);
  const setFlag = useCategoryFlagsStore((s) => s.setFlag);
  const flagsHydrate = useCategoryFlagsStore((s) => s.hydrate);
  const flagsLoaded = useCategoryFlagsStore((s) => s.loaded);
  useEffect(() => {
    if (!flagsLoaded) flagsHydrate();
  }, [flagsLoaded, flagsHydrate]);

  function cycleFlag(category: string) {
    const cur = flags[category];
    if (!cur) setFlag(category, "fixed");
    else if (cur === "fixed") setFlag(category, "discretionary");
    else setFlag(category, null);
  }

  const filtered = useMemo(() => applyFilters(transactions, filters, monthStartDay), [transactions, filters, monthStartDay]);
  const tree = useMemo(() => buildHierarchy(filtered, kind), [filtered, kind]);

  // Single source of truth for "what colour belongs to this category".
  // Donut / Treemap / Иерархия sidebar all consult this map. Zenmoney's
  // `tag.color` wins; otherwise a DETERMINISTIC colour from the name (shared
  // `colorForCategory`), so the same category matches every other page.
  const resolvedCategoryColors = useMemo(() => {
    const m: Record<string, string> = {};
    for (const node of tree) m[node.name] = colorForCategory(node.name, categoryMeta);
    return m;
  }, [tree, categoryMeta]);

  const totalAll = tree.reduce((s, n) => s + n.total, 0);

  // Donut (issue #7): a SINGLE ring, ZenMoney-style. Top level shows
  // categories; clicking a category that has subcategories drills INTO it —
  // the ring becomes that category's subcategories (shades of the parent
  // colour) with a «Назад» button. Hovering a category shows a tooltip with
  // its total plus a per-subcategory breakdown.
  interface DonutDatum {
    name: string;
    value: number;
    color: string;
    opacity: number;
    fullName?: string;
    remainder: boolean;
    hasSubs: boolean;
  }
  const [donutCat, setDonutCat] = useState<string | null>(null);

  const catByName = useMemo(() => {
    const m = new Map<string, CategoryNode>();
    for (const n of tree) m.set(n.name, n);
    return m;
  }, [tree]);

  // The effective drill-in: null at top level, or the drilled category — but
  // only if it still exists (filters / kind switch can drop it). Derived, so
  // no effect/setState dance is needed when the underlying data changes.
  const drillCat = donutCat && catByName.has(donutCat) ? donutCat : null;

  const DONUT_CATS = 15;
  const donutTop = useMemo<DonutDatum[]>(
    () =>
      tree
        .filter((n) => n.total > 0)
        .slice(0, DONUT_CATS)
        .map((n) => ({
          name: n.name,
          value: n.total,
          color: resolvedCategoryColors[n.name] || COLORS[0],
          opacity: 1,
          remainder: false,
          hasSubs: n.subs.some((s) => s.total > 0),
        })),
    [tree, resolvedCategoryColors]
  );

  const donutDrillNode = drillCat ? catByName.get(drillCat) ?? null : null;

  const donutSub = useMemo<DonutDatum[]>(() => {
    if (!donutDrillNode) return [];
    const color = resolvedCategoryColors[donutDrillNode.name] || COLORS[0];
    const posSubs = donutDrillNode.subs.filter((s) => s.total > 0);
    const subSum = posSubs.reduce((s, x) => s + x.total, 0);
    const out: DonutDatum[] = posSubs.map((sub, idx) => ({
      name: sub.name,
      fullName: sub.fullName,
      value: sub.total,
      color,
      opacity: Math.max(0.45, 1 - idx * 0.13),
      remainder: false,
      hasSubs: false,
    }));
    const rem = donutDrillNode.total - subSum;
    if (rem > 0.0001) {
      out.push({
        name: "Без подкатегории",
        value: rem,
        color,
        opacity: 0.3,
        remainder: true,
        hasSubs: false,
      });
    }
    return out;
  }, [donutDrillNode, resolvedCategoryColors]);

  const donutData = drillCat ? donutSub : donutTop;

  function onDonutClick(name?: string) {
    if (!name) return;
    if (drillCat) {
      const item = donutSub.find((s) => s.name === name);
      if (item && !item.remainder && item.fullName) openSubcategory(item.fullName);
      else openCategory(drillCat);
    } else {
      const item = donutTop.find((c) => c.name === name);
      if (item?.hasSubs) setDonutCat(name);
      else openCategory(name);
    }
  }

  // Shared tooltip box: a category's total + its subcategory breakdown.
  // Used by the donut (top level) and the «Все категории» bar chart so both
  // read identically.
  function categoryBreakdownBox(name: string, value: number) {
    const node = catByName.get(name);
    const subs = node ? node.subs.filter((s) => s.total > 0) : [];
    return (
      <div className="rounded-lg border border-border bg-panel shadow-lg px-3 py-2 text-sm max-w-[260px]">
        <div className="font-medium">{name}</div>
        <div className="text-muted">
          {formatMoney(value, base)} ({formatPct(value / totalAll, 1)})
        </div>
        {subs.length > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-border space-y-0.5">
            {subs.slice(0, 8).map((s) => (
              <div
                key={s.fullName}
                className="flex items-center justify-between gap-3 text-xs text-muted"
              >
                <span className="truncate">{s.name}</span>
                <span className="tabular-nums shrink-0">
                  {formatMoney(s.total, base)} ({formatPct(s.total / node!.total, 0)})
                </span>
              </div>
            ))}
            {subs.length > 8 && (
              <div className="text-xs text-muted">…ещё {subs.length - 8}</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Donut tooltip: category breakdown at the top level, or the single
  // subcategory's share when drilled in.
  function renderDonutTooltip(props: {
    active?: boolean;
    payload?: readonly { payload?: DonutDatum }[];
  }) {
    if (!props.active || !props.payload?.length) return null;
    const d = props.payload[0]?.payload;
    if (!d) return null;
    if (drillCat) {
      return (
        <div className="rounded-lg border border-border bg-panel shadow-lg px-3 py-2 text-sm max-w-[260px]">
          <div className="font-medium">{d.name}</div>
          <div className="text-muted">
            {formatMoney(d.value, base)} ({formatPct(d.value / totalAll, 1)})
          </div>
        </div>
      );
    }
    return categoryBreakdownBox(d.name, d.value);
  }

  // Bar-chart tooltip — same category breakdown box, keyed off the hovered row.
  function renderBarTooltip(props: {
    active?: boolean;
    payload?: readonly { payload?: { name?: string } }[];
  }) {
    if (!props.active || !props.payload?.length) return null;
    const name = props.payload[0]?.payload?.name;
    if (!name) return null;
    const node = catByName.get(name);
    return categoryBreakdownBox(name, node ? node.total : 0);
  }

  // Treemap tooltip — resolves the hovered cell to its CATEGORY and shows the
  // same breakdown box as the donut/bars (a subcategory cell carries `cat`).
  function renderTreemapTooltip(props: {
    active?: boolean;
    payload?: readonly { payload?: { cat?: string; name?: string } }[];
  }) {
    if (!props.active || !props.payload?.length) return null;
    const p = props.payload[0]?.payload;
    const cat = p?.cat || p?.name;
    if (!cat) return null;
    const node = catByName.get(cat);
    return categoryBreakdownBox(cat, node ? node.total : 0);
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

  // ── Outside donut labels with leader lines ────────────────────────────
  // Recharts' own outside labels don't de-overlap, so for the crowded right
  // side we draw our own: anchor on the ring → elbow → horizontal line out to
  // a label, with the per-side column spread vertically so nothing collides.
  // Needs the live pixel size, so we measure the chart box.
  const DONUT_OUTER = 178;
  const DONUT_INNER = 104;
  const donutBoxRef = useRef<HTMLDivElement>(null);
  const [donutBox, setDonutBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = donutBoxRef.current;
    if (!el) return;
    const measure = () => setDonutBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const donutLabels = useMemo(() => {
    const { w, h } = donutBox;
    if (!w || !h) return [];
    const total = donutData.reduce((s, d) => s + d.value, 0);
    if (total <= 0) return [];
    const cx = w / 2;
    const cy = h / 2;
    const RAD = Math.PI / 180;
    const MIN_PCT = 0.012; // skip slivers — a leader line to a 1% sliver is noise
    const GAP = 16; // min vertical spacing between labels on one side

    // Cumulative value BEFORE each slice (array writes — no binding reassign).
    const starts: number[] = [];
    donutData.forEach((_, i) => {
      starts[i] = i === 0 ? 0 : starts[i - 1] + donutData[i - 1].value;
    });
    const raw = donutData
      .map((d, i) => {
        const frac = d.value / total;
        const ang = ((starts[i] + d.value / 2) / total) * 360; // CCW from 3 o'clock
        const cos = Math.cos(ang * RAD);
        const sin = Math.sin(ang * RAD);
        return { d, frac, cos, sin };
      })
      .filter((r) => r.frac >= MIN_PCT);

    const sides: Record<"r" | "l", typeof raw> = { r: [], l: [] };
    for (const r of raw) (r.cos >= 0 ? sides.r : sides.l).push(r);

    const out: {
      key: string;
      color: string;
      text: string;
      ax: number;
      ay: number;
      mx: number;
      labelX: number;
      labelY: number;
      anchor: "start" | "end";
    }[] = [];

    (["r", "l"] as const).forEach((side) => {
      const col = sides[side]
        .map((r) => ({
          r,
          ax: cx + DONUT_OUTER * r.cos,
          ay: cy - DONUT_OUTER * r.sin,
          y: cy - DONUT_OUTER * r.sin, // natural label y, then spread
        }))
        .sort((a, b) => a.y - b.y);
      // push down overlaps, then shift the whole column up if it overflows
      for (let i = 1; i < col.length; i++) {
        if (col[i].y - col[i - 1].y < GAP) col[i].y = col[i - 1].y + GAP;
      }
      const overflow = col.length ? col[col.length - 1].y - (h - 10) : 0;
      if (overflow > 0) col.forEach((c) => (c.y -= overflow));
      const mx = side === "r" ? cx + DONUT_OUTER + 16 : cx - DONUT_OUTER - 16;
      const labelX = side === "r" ? mx + 4 : mx - 4;
      for (const c of col) {
        out.push({
          key: c.r.d.name,
          color: c.r.d.color,
          text: `${c.r.d.name} ${Math.round(c.r.frac * 100)}%`,
          ax: c.ax,
          ay: c.ay,
          mx,
          labelX,
          labelY: c.y,
          anchor: side === "r" ? "start" : "end",
        });
      }
    });
    return out;
  }, [donutData, donutBox]);

  // Treemap «Карта категорий»: nested — categories subdivided into their
  // subcategory cells (opaque shades of the parent colour) + a «без
  // подкатегории» remainder. Categories without subs stay single cells.
  // Plain computation (no useMemo) — the React Compiler auto-memoizes it, and
  // a manual memo around the helper call can't be statically preserved.
  const treemapData = tree
    .filter((n) => n.total > 0)
    .slice(0, TREEMAP_CATS)
    .map((n) => buildTreemapNode(n, resolvedCategoryColors[n.name] || COLORS[0]));

  // «Все категории» stacked bars: each category bar is split into its
  // subcategory segments (shades of the category colour, like the donut),
  // plus a «без подкатегории» remainder. Rendered as N stacked series so the
  // segment count can differ per row.
  const BAR_CATS = 25;
  const barRows = useMemo(() => {
    return tree
      .filter((n) => n.total > 0)
      .slice(0, BAR_CATS)
      .map((n) => {
        const color = resolvedCategoryColors[n.name] || COLORS[0];
        const posSubs = n.subs.filter((s) => s.total > 0);
        const subSum = posSubs.reduce((s, x) => s + x.total, 0);
        const segs = posSubs.map((sub, idx) => ({
          name: sub.name,
          fullName: sub.fullName as string | undefined,
          value: sub.total,
          color,
          opacity: Math.max(0.45, 1 - idx * 0.13),
        }));
        const rem = n.total - subSum;
        if (rem > 0.0001) {
          segs.push({
            name: posSubs.length ? "Без подкатегории" : n.name,
            fullName: undefined,
            value: rem,
            color,
            opacity: posSubs.length ? 0.3 : 1,
          });
        }
        return { name: n.name, total: n.total, segs };
      });
  }, [tree, resolvedCategoryColors]);

  const barMaxSegs = useMemo(
    () => barRows.reduce((m, r) => Math.max(m, r.segs.length), 0),
    [barRows]
  );

  const barData = useMemo(
    () =>
      barRows.map((r) => {
        const o: Record<string, string | number> = { name: r.name };
        r.segs.forEach((s, i) => {
          o[`seg${i}`] = s.value;
        });
        return o;
      }),
    [barRows]
  );

  function openBarSeg(rowIndex: number, segIndex: number) {
    const row = barRows[rowIndex];
    if (!row) return;
    const seg = row.segs[segIndex];
    if (seg?.fullName) openSubcategory(seg.fullName);
    else openCategory(row.name);
  }

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
                onClick={() => setView("donut")}
                className={`px-3 py-1 text-xs rounded-md ${view === "donut" ? "bg-accent text-accent-fg" : "text-muted"}`}
              >
                Donut
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card card-pad lg:col-span-2">
          {/* Fixed height so drilling in/out (which toggles the «Назад»
              link) doesn't change the header height and nudge the chart. */}
          <div className="mb-3 flex items-center gap-2 h-7">
            {view === "donut" && drillCat && (
              <button
                onClick={() => setDonutCat(null)}
                className="inline-flex items-center gap-0.5 text-xs text-accent hover:underline shrink-0"
                title="Вернуться к категориям"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Назад
              </button>
            )}
            <div className="font-semibold truncate">
              {view === "donut"
                ? drillCat
                  ? `Подкатегории: ${drillCat}`
                  : "Доля категорий"
                : "Карта категорий"}
            </div>
            {view === "treemap" && (
              <button
                onClick={() => setTreemapFull(true)}
                className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-accent shrink-0"
                title="Открыть на весь экран"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                На весь экран
              </button>
            )}
          </div>
          <div className="h-[450px] relative" ref={donutBoxRef}>
            {view === "donut" ? (
              <>
                {/* Centre label — category/total, sits over the ring's hole. */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center px-6">
                    <div className="text-xs text-muted truncate max-w-[150px]">
                      {drillCat ?? (kind === "expense" ? "Расходы" : "Доходы")}
                    </div>
                    <div className="font-semibold tabular-nums">
                      {formatMoney(
                        drillCat ? donutDrillNode?.total ?? 0 : totalAll,
                        base
                      )}
                    </div>
                  </div>
                </div>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={DONUT_INNER}
                      outerRadius={DONUT_OUTER}
                      paddingAngle={1}
                      cursor="pointer"
                      onClick={(d: { name?: string }) => onDonutClick(d?.name)}
                      labelLine={false}
                      // Same rationale as Treemap: Recharts' default
                      // sector-grow animation creates a momentary double-
                      // paint when filters change. Static render is plenty
                      // fast and looks calmer.
                      isAnimationActive={false}
                    >
                      {donutData.map((d, i) => (
                        <Cell key={i} fill={d.color} fillOpacity={d.opacity} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={renderDonutTooltip}
                      // Without this the wrapper animates its position from
                      // the chart origin (top-left) on every hover — looks
                      // like the tooltip "flies in" from the corner.
                      isAnimationActive={false}
                      cursor={false}
                      // The leader-line overlay below is a later DOM sibling,
                      // so it would otherwise paint over the tooltip — lift the
                      // tooltip above it.
                      wrapperStyle={{ zIndex: 50 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Leader-line labels overlay (de-overlapped per side). */}
                {donutBox.w > 0 && (
                  <svg
                    className="absolute inset-0 pointer-events-none"
                    width={donutBox.w}
                    height={donutBox.h}
                  >
                    {donutLabels.map((L) => (
                      <g key={L.key}>
                        <polyline
                          points={`${L.ax},${L.ay} ${L.mx},${L.labelY} ${L.labelX},${L.labelY}`}
                          fill="none"
                          stroke="rgb(var(--c-muted))"
                          strokeOpacity={0.35}
                          strokeWidth={1}
                        />
                        <text
                          x={L.labelX}
                          y={L.labelY}
                          textAnchor={L.anchor}
                          dominantBaseline="central"
                          fontSize={12}
                          fill={L.color}
                        >
                          {L.text}
                        </text>
                      </g>
                    ))}
                  </svg>
                )}
              </>
            ) : (
              renderTreemap()
            )}
          </div>
        </div>

        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">Иерархия</div>
            <div className="flex gap-1 text-xs">
              <button onClick={expandAll} className="text-muted hover:text-accent">
                развернуть
              </button>
              <span className="text-muted">·</span>
              <button onClick={collapseAll} className="text-muted hover:text-accent">
                свернуть
              </button>
            </div>
          </div>
          <div className="space-y-1 max-h-[480px] overflow-y-auto pr-1">
            {tree.map((node, i) => {
              // Single source of truth — same map the Donut and Treemap
              // consult, so the swatch next to a category here always
              // matches its slice/cell in the chart on the left.
              const color = resolvedCategoryColors[node.name] || COLORS[i % COLORS.length];
              const isOpen = expanded.has(node.name);
              const hasSubs = node.subs.length > 0;
              return (
                <div key={node.name}>
                  <div className="flex items-center gap-1 group hover:bg-panel2/40 rounded px-1 py-1">
                    <button
                      onClick={() => hasSubs && toggleExpand(node.name)}
                      className={clsx(
                        "shrink-0 w-5 h-5 flex items-center justify-center text-muted",
                        !hasSubs && "invisible"
                      )}
                    >
                      {isOpen ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <span className="w-2.5 h-2.5 rounded shrink-0" style={{ background: color }} />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        cycleFlag(node.name);
                      }}
                      className="shrink-0 text-muted hover:text-accent"
                      title={
                        flags[node.name] === "fixed"
                          ? "Фиксированная — клик: сделать дискретной"
                          : flags[node.name] === "discretionary"
                            ? "Дискретная — клик: убрать флаг"
                            : "Без флага — клик: сделать фиксированной"
                      }
                    >
                      {flags[node.name] === "fixed" ? (
                        <Lock className="w-3 h-3 text-warn" />
                      ) : flags[node.name] === "discretionary" ? (
                        <Coffee className="w-3 h-3 text-accent2" />
                      ) : (
                        <Lock className="w-3 h-3 opacity-25" />
                      )}
                    </button>
                    <button
                      onClick={() => openCategory(node.name)}
                      className="flex-1 text-left min-w-0 text-sm hover:text-accent"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate" title={node.name}>
                          {node.name}
                        </span>
                        <span className="tabular-nums shrink-0 text-xs">
                          {formatMoney(node.total, base)}
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px] text-muted">
                        <span>
                          {node.count} оп.
                          {hasSubs && ` · ${node.subs.length} подкат.`}
                        </span>
                        <span>{formatPct(node.total / totalAll, 1)}</span>
                      </div>
                      <div className="h-1 bg-panel2 rounded-full overflow-hidden mt-0.5">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(node.total / (tree[0]?.total || 1)) * 100}%`,
                            background: color,
                          }}
                        />
                      </div>
                    </button>
                  </div>

                  {isOpen && hasSubs && (
                    <div className="ml-7 mt-1 mb-2 space-y-1 border-l border-border pl-3">
                      {node.subs.map((sub) => (
                        <button
                          key={sub.fullName}
                          onClick={() => openSubcategory(sub.fullName)}
                          className="w-full text-left text-xs hover:text-accent group/sub"
                        >
                          <div className="flex items-center justify-between gap-2 py-0.5">
                            <span className="truncate text-muted group-hover/sub:text-text">
                              {sub.name}
                            </span>
                            <span className="tabular-nums shrink-0 text-muted">
                              {formatMoney(sub.total, base)}
                              <span className="text-[10px] ml-1">
                                ({formatPct(sub.total / node.total, 0)})
                              </span>
                            </span>
                          </div>
                          <div className="h-0.5 bg-panel2 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full opacity-60"
                              style={{
                                width: `${(sub.total / node.total) * 100}%`,
                                background: color,
                              }}
                            />
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="font-semibold mb-1">Все категории</div>
        <div className="text-[11px] text-muted mb-3">
          Каждый бар разбит на подкатегории. Наведите — увидите разбивку.
        </div>
        <div className="h-96">
          <ResponsiveContainer>
            <BarChart
              data={barData}
              layout="vertical"
              margin={{ left: 100 }}
              style={{ cursor: "pointer" }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
              <XAxis type="number" stroke={chartAxisStroke} fontSize={11} tickFormatter={(v) => formatNum(v, { compact: true })} />
              {/*
                `interval={0}` forces Recharts to render *every* tick.
                Without it the YAxis default (`preserveEnd`) starts
                skipping labels when there are more bars than can be
                spaced out — users were reporting bars with no label
                next to them at the top of this chart.
              */}
              <YAxis
                type="category"
                dataKey="name"
                stroke={chartAxisStroke}
                fontSize={11}
                width={160}
                interval={0}
              />
              <Tooltip
                content={renderBarTooltip}
                isAnimationActive={false}
                cursor={{ fill: "rgb(var(--c-panel2))", fillOpacity: 0.5 }}
                wrapperStyle={{ zIndex: 50 }}
              />
              {/* One stacked series per subcategory slot; a row only fills the
                  slots it actually has, so bars carry as many segments as the
                  category has subcategories (+ remainder). */}
              {Array.from({ length: Math.max(1, barMaxSegs) }).map((_, i) => (
                <Bar
                  key={i}
                  dataKey={`seg${i}`}
                  stackId="cat"
                  isAnimationActive={false}
                  cursor="pointer"
                  onClick={(_d: unknown, index: number) => openBarSeg(index, i)}
                >
                  {barRows.map((r, ri) => {
                    const seg = r.segs[i];
                    return (
                      <Cell
                        key={ri}
                        fill={seg ? seg.color : "transparent"}
                        fillOpacity={seg ? seg.opacity : 0}
                      />
                    );
                  })}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
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
