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
import { ChevronRight, ChevronDown, MousePointerClick, Lock, Coffee } from "lucide-react";
import clsx from "clsx";
import { useEffect } from "react";
import { useDataStore } from "../store/useDataStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useDrillStore } from "../store/useDrillStore";
import { useCategoryFlagsStore } from "../store/useCategoryFlagsStore";
import { groupByCategory } from "../lib/aggregations";
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
import type { Transaction } from "../types";

const COLORS = [
  "#22D3EE", "#A78BFA", "#F59E0B", "#10B981", "#EF4444",
  "#EC4899", "#3B82F6", "#84CC16", "#F97316", "#14B8A6",
  "#8B5CF6", "#06B6D4", "#FBBF24", "#34D399", "#F472B6",
];

// Pick black/white text colour by the cell's perceived brightness so labels
// stay readable against any palette colour. Accepts both `#RRGGBB` (palette)
// and `rgb(R, G, B)` (Zenmoney-derived) forms.
function readableTextOn(color: string): string {
  let r = 0;
  let g = 0;
  let b = 0;
  const rgb = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  const hex = color.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (rgb) {
    r = Number(rgb[1]);
    g = Number(rgb[2]);
    b = Number(rgb[3]);
  } else if (hex) {
    r = parseInt(hex[1], 16);
    g = parseInt(hex[2], 16);
    b = parseInt(hex[3], 16);
  } else {
    return "#0B1120";
  }
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq > 160 ? "#0B1120" : "#FFFFFF";
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
  } = props;
  if (width < 1 || height < 1) return <g />;
  // Prefer the category's own colour from Zenmoney; fall back to the palette.
  const fill =
    (categoryColors && categoryColors[name]) || colors[index % colors.length];
  const textColor = readableTextOn(fill);
  const subColor = textColor === "#FFFFFF" ? "rgba(255,255,255,0.78)" : "rgba(11,17,32,0.72)";

  // Choose label sizing by cell area so small cells still show their name
  // (just smaller), big cells get a bolder layout. Char width estimates are
  // tuned for the system sans-serif at the chosen px size.
  const tier =
    width >= 140 && height >= 60
      ? "lg"
      : width >= 80 && height >= 40
        ? "md"
        : width >= 40 && height >= 24
          ? "sm"
          : "xs";

  const titleSize = tier === "lg" ? 13 : tier === "md" ? 12 : 11;
  const charPx = titleSize * 0.55;
  const padX = tier === "xs" ? 4 : 6;
  const maxChars = Math.max(1, Math.floor((width - padX * 2) / charPx));
  const label = truncateToWidth(name, maxChars);

  const showAmount = tier !== "xs" && height >= titleSize * 2 + 6;
  const amountText = formatMoney(value, base, { compact: true });
  const amountSize = tier === "lg" ? 12 : 11;
  const amountChars = Math.max(1, Math.floor((width - padX * 2) / (amountSize * 0.55)));
  const amount = truncateToWidth(amountText, amountChars);

  return (
    <g style={{ cursor: "pointer" }}>
      <title>{`${name} · ${amountText}`}</title>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        stroke="rgb(var(--c-bg))"
        strokeWidth={2}
      />
      <text
        x={x + padX}
        y={y + titleSize + 4}
        fill={textColor}
        fontSize={titleSize}
        fontWeight={600}
        fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        style={{ pointerEvents: "none" }}
      >
        {label}
      </text>
      {showAmount && (
        <text
          x={x + padX}
          y={y + titleSize + amountSize + 8}
          fill={subColor}
          fontSize={amountSize}
          fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
          style={{ pointerEvents: "none" }}
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
    if (t.kind !== kind) continue;
    let node = map.get(t.category);
    if (!node) {
      node = { name: t.category, total: 0, count: 0, subs: [] };
      map.set(t.category, node);
    }
    node.total += t.amountBase;
    node.count++;
    if (t.subcategory) {
      let sub = node.subs.find((s) => s.name === t.subcategory);
      if (!sub) {
        sub = { name: t.subcategory, fullName: t.categoryFull, total: 0, count: 0 };
        node.subs.push(sub);
      }
      sub.total += t.amountBase;
      sub.count++;
    }
  }
  for (const node of map.values()) {
    node.subs.sort((a, b) => b.total - a.total);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export function CategoriesPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const metaLoaded = useCategoryMetaStore((s) => s.loaded);
  const hydrateMeta = useCategoryMetaStore((s) => s.hydrate);
  useEffect(() => {
    if (!metaLoaded) hydrateMeta();
  }, [metaLoaded, hydrateMeta]);
  const categoryColors = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const [name, info] of Object.entries(categoryMeta)) {
      m[name] = info.color;
    }
    return m;
  }, [categoryMeta]);
  const filters = useFiltersStore();

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

  const filtered = useMemo(() => applyFilters(transactions, filters), [transactions, filters]);
  const tree = useMemo(() => buildHierarchy(filtered, kind), [filtered, kind]);

  const totalAll = tree.reduce((s, n) => s + n.total, 0);

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
    const txs = filtered.filter((t) => t.kind === kind && t.category === name);
    showDrill(name, txs, kind === "expense" ? "Расходы по категории" : "Доходы по категории");
  }
  function openSubcategory(fullName: string) {
    const txs = filtered.filter((t) => t.kind === kind && t.categoryFull === fullName);
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

  const max = data[0]?.value || 1;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Разбивка по категориям
            <MousePointerClick className="w-4 h-4 text-muted" />
          </h1>
          <p className="text-muted text-sm mt-1">
            {tree.length} категорий · всего {formatMoney(totalAll, base, { compact: true })} · клик
            по любому элементу — список операций
          </p>
        </div>
        <div className="flex gap-2">
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card card-pad lg:col-span-2">
          <div className="font-semibold mb-3">
            {view === "donut" ? "Доля категорий (клик)" : "Карта категорий (клик)"}
          </div>
          <div className="h-[450px]">
            {view === "donut" ? (
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={data.slice(0, 15)}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={160}
                    paddingAngle={1}
                    onClick={(d: { name?: string }) => d?.name && openCategory(d.name)}
                    cursor="pointer"
                    label={({ name, percent }) =>
                      percent && percent > 0.04 ? `${name} ${(percent * 100).toFixed(0)}%` : ""
                    }
                    labelLine={false}
                  >
                    {data.slice(0, 15).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    {...chartTooltipProps}
                    formatter={(v: unknown, _n: unknown, p: { payload?: { name?: string } }) => {
                      const n = toNum(v);
                      return [
                        `${formatMoney(n, base, { compact: true })} (${formatPct(n / totalAll, 1)})`,
                        p.payload?.name ?? "",
                      ];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer>
                <Treemap
                  data={data.slice(0, 30)}
                  dataKey="value"
                  stroke="rgb(var(--c-bg))"
                  fill="#22D3EE"
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
                      categoryColors={categoryColors}
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
              const color = categoryColors[node.name] || COLORS[i % COLORS.length];
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
                          {formatMoney(node.total, base, { compact: true })}
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
                              {formatMoney(sub.total, base, { compact: true })}
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
        <div className="font-semibold mb-3">Все категории (клик по бару)</div>
        <div className="h-96">
          <ResponsiveContainer>
            <BarChart
              data={data.slice(0, 25)}
              layout="vertical"
              margin={{ left: 100 }}
              onClick={(e: unknown) => {
                const ev = e as { activePayload?: { payload?: { name?: string } }[] } | undefined;
                const name = ev?.activePayload?.[0]?.payload?.name;
                if (name) openCategory(name);
              }}
              style={{ cursor: "pointer" }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
              <XAxis type="number" stroke={chartAxisStroke} fontSize={11} tickFormatter={(v) => formatNum(v, { compact: true })} />
              <YAxis type="category" dataKey="name" stroke={chartAxisStroke} fontSize={11} width={150} />
              <Tooltip
                {...chartTooltipProps}
                formatter={(v: unknown) => formatMoney(toNum(v), base, { compact: true })}
              />
              <Bar
                dataKey="value"
                name={kind === "expense" ? "Расход" : "Доход"}
                radius={[0, 4, 4, 0]}
                activeBar={false}
              >
                {data.slice(0, 25).map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="text-xs text-muted mt-2">
          Показаны топ-25 (всего {data.length}). Используется максимум {Math.round(max / 1000)}K {base}.
        </div>
      </div>
    </div>
  );
}
