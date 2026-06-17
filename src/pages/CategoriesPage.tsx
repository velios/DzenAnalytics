import { useMemo, useState } from "react";
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
import { ChevronRight, ChevronLeft, ChevronDown, Lock, Coffee } from "lucide-react";
import clsx from "clsx";
import { useEffect } from "react";
import { useDataStore } from "../store/useDataStore";
import { useThemeStore } from "../store/useThemeStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import { useCategoryFlagsStore } from "../store/useCategoryFlagsStore";
import { groupByCategory } from "../lib/aggregations";
import { affectsExpense, expenseDelta } from "../lib/txKindStyle";
import { colorForCategory } from "../lib/categoryColor";
import {
  formatMoney,
  formatNum,
  formatPct,
  toNum,
  chartTooltipProps,
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

interface TreemapCellProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  name?: string;
  value?: number;
  base: string;
  colors: string[];
  categoryColors?: Record<string, string | null>;
  theme: "light" | "dark";
}

function TreemapCell(props: TreemapCellProps) {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    index = 0,
    name = "",
    value = 0,
    base,
    colors,
    categoryColors,
    theme,
  } = props;
  if (width < 1 || height < 1) return <g />;
  // Prefer the category's own colour from Zenmoney; fall back to the palette.
  const fill =
    (categoryColors && categoryColors[name]) || colors[index % colors.length];
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

  // Custom tooltip: category total + its subcategory breakdown (top level),
  // or the single subcategory's share (drilled in).
  function renderDonutTooltip(props: {
    active?: boolean;
    payload?: readonly { payload?: DonutDatum }[];
  }) {
    if (!props.active || !props.payload?.length) return null;
    const d = props.payload[0]?.payload;
    if (!d) return null;
    const node = !drillCat ? catByName.get(d.name) : null;
    const subs = node ? node.subs.filter((s) => s.total > 0) : [];
    return (
      <div className="rounded-lg border border-border bg-panel shadow-lg px-3 py-2 text-sm max-w-[260px]">
        <div className="font-medium">{d.name}</div>
        <div className="text-muted">
          {formatMoney(d.value, base)} ({formatPct(d.value / totalAll, 1)})
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

  const flatTopGroups = useMemo(
    () => groupByCategory(filtered, "top").filter((g) => (kind === "expense" ? g.expense : g.income) > 0),
    [filtered, kind]
  );

  const data = flatTopGroups.map((g) => ({
    name: g.category,
    value: kind === "expense" ? g.expense : g.income,
    count: g.count,
  }));

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
        title="Разбивка по категориям"
        hint={`${tree.length} категорий · всего ${formatMoney(totalAll, base)}. Клик по элементу — список операций.`}
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
          <div className="mb-3 flex items-center gap-2">
            {view === "donut" && drillCat && (
              <button
                onClick={() => setDonutCat(null)}
                className="btn-ghost text-xs"
                title="Вернуться к категориям"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Назад
              </button>
            )}
            <div className="font-semibold">
              {view === "donut"
                ? drillCat
                  ? `Подкатегории: ${drillCat}`
                  : "Доля категорий"
                : "Карта категорий"}
            </div>
          </div>
          <div className="h-[450px] relative">
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
                      innerRadius={80}
                      outerRadius={160}
                      paddingAngle={1}
                      cursor="pointer"
                      onClick={(d: { name?: string }) => onDonutClick(d?.name)}
                      label={({ name, percent }) =>
                        percent && percent > 0.04 ? `${name} ${(percent * 100).toFixed(0)}%` : ""
                      }
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
                    <Tooltip content={renderDonutTooltip} />
                  </PieChart>
                </ResponsiveContainer>
              </>
            ) : (
              <ResponsiveContainer>
                <Treemap
                  data={data.slice(0, 30)}
                  dataKey="value"
                  stroke="rgb(var(--c-bg))"
                  fill="#22D3EE"
                  // Recharts' default cell animation re-paints SVG between
                  // frames; when intermediate paints overlap a freshly-
                  // rendered cell at the same place, glyphs can briefly
                  // double-stamp. Static layout is plenty fast here.
                  isAnimationActive={false}
                  onClick={(d: { name?: string }) => d?.name && openCategory(d.name)}
                  content={(props: {
                    x?: number;
                    y?: number;
                    width?: number;
                    height?: number;
                    index?: number;
                    name?: string;
                    value?: number;
                  }) => (
                    <TreemapCell
                      {...props}
                      base={base}
                      colors={COLORS}
                      categoryColors={resolvedCategoryColors}
                      theme={theme}
                    />
                  )}
                />
              </ResponsiveContainer>
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
        <div className="font-semibold mb-3">Все категории</div>
        <div className="h-96">
          <ResponsiveContainer>
            <BarChart
              data={data.slice(0, 25)}
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
                {...chartTooltipProps}
                // Bars are coloured per-category via <Cell>, so the Bar has no
                // own fill and Recharts falls back to a dark item colour that's
                // unreadable in dark theme. Pin the value line to the theme text
                // colour (single series, so no per-series colour is lost).
                itemStyle={{ color: "rgb(var(--c-text))" }}
                formatter={(v: unknown) => formatMoney(toNum(v), base)}
              />
              <Bar
                dataKey="value"
                name={kind === "expense" ? "Расход" : "Доход"}
                radius={[0, 4, 4, 0]}
                activeBar={false}
                cursor="pointer"
                onClick={(d: unknown) => {
                  const p = d as { name?: string; payload?: { name?: string } };
                  const name = p?.name ?? p?.payload?.name;
                  if (name) openCategory(name);
                }}
              >
                {data.slice(0, 25).map((d, i) => (
                  <Cell
                    key={i}
                    fill={
                      resolvedCategoryColors[d.name] || COLORS[i % COLORS.length]
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <CategoryRequiredEditor />
    </div>
  );
}
