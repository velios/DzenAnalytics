import { useMemo } from "react";
import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { GitFork } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { buildSankey } from "../lib/aggregations";
import { formatMoney, toNum, chartTooltipProps } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";

const COLORS = {
  income: "#10B981",
  account: "#22D3EE",
  category: "#EF4444",
};

export function SankeyPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();

  const filtered = useMemo(() => applyFilters(transactions, filters), [transactions, filters]);
  const data = useMemo(() => buildSankey(filtered), [filtered]);

  if (transactions.length === 0) return <EmptyState />;

  if (data.links.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={GitFork}
          title="Потоки денег"
          hint="Слева — источники доходов, справа — категории расходов."
        />
        <GlobalFilters />
        <div className="card card-pad text-center py-12 text-muted">
          Нет данных для построения потоков в текущем фильтре.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={GitFork}
        title="Потоки денег"
        hint="Слева — источники доходов, справа — категории расходов."
      />
      <GlobalFilters />

      <div className="card card-pad">
        <div className="h-[600px]">
          <ResponsiveContainer>
            <Sankey
              data={data}
              nodePadding={20}
              nodeWidth={14}
              linkCurvature={0.5}
              iterations={64}
              link={{ stroke: "rgb(var(--c-muted))", strokeOpacity: 0.15 }}
              node={({ x, y, width, height, index, payload }: {
                x?: number; y?: number; width?: number; height?: number; index?: number;
                payload?: { name?: string; kind?: "income" | "account" | "category"; value?: number };
              }) => {
                const xv = x ?? 0;
                const yv = y ?? 0;
                const w = width ?? 0;
                const h = height ?? 0;
                const kind = payload?.kind || "account";
                const fill = COLORS[kind];
                const isLeft = xv < 200;
                return (
                  <g key={`node-${index}`}>
                    <rect x={xv} y={yv} width={w} height={h} fill={fill} fillOpacity={0.8} />
                    <text
                      x={isLeft ? xv - 6 : xv + w + 6}
                      y={yv + h / 2}
                      textAnchor={isLeft ? "end" : "start"}
                      dominantBaseline="middle"
                      fontSize={11}
                      fill="rgb(var(--c-text))"
                    >
                      {payload?.name}
                    </text>
                  </g>
                );
              }}
            >
              <Tooltip
                {...chartTooltipProps}
                formatter={(v: unknown) => formatMoney(toNum(v), base, { compact: true })}
              />
            </Sankey>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-muted justify-center">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ background: COLORS.income }} />
            Источники доходов
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ background: COLORS.account }} />
            Бюджет
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ background: COLORS.category }} />
            Категории расходов
          </span>
        </div>
      </div>
    </div>
  );
}
