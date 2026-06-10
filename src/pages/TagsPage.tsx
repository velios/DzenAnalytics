import { useMemo, useState } from "react";
import { Hash, MousePointerClick, ChevronRight, ChevronDown } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { useDrillStore } from "../store/useDrillStore";
import {
  groupByHashtag,
  extractHashtags,
  hashtagCategoryTrees,
  type TagBucket,
} from "../lib/aggregations";
import { formatMoney, formatPct } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { SortableTable, type Column } from "../components/SortableTable";

export function TagsPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);
  const showDrill = useDrillStore((s) => s.show);

  const filtered = useMemo(() => applyFilters(transactions, filters, monthStartDay), [transactions, filters, monthStartDay]);
  const tags = useMemo(() => groupByHashtag(filtered), [filtered]);
  // Per-tag expense breakdown by category → subcategory.
  const catTrees = useMemo(() => hashtagCategoryTrees(filtered), [filtered]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (tag: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  const totalExpense = tags.reduce((s, t) => s + t.expense, 0);
  const taggedCount = useMemo(
    () => filtered.filter((t) => extractHashtags(t.comment).length > 0).length,
    [filtered]
  );

  const maxTotal = tags[0] ? tags[0].expense + tags[0].income : 1;

  function openTag(tag: string) {
    const txs = filtered.filter((t) => extractHashtags(t.comment).includes(tag));
    showDrill(`#${tag}`, txs, "Операции с тегом");
  }

  if (transactions.length === 0) return <EmptyState />;

  if (tags.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={Hash}
          title="Хэштеги"
          hint="Метки `#проект` в комментариях позволяют группировать операции по темам — поездки, члены семьи, машины и так далее. В текущей выборке хэштегов нет."
        />
        <GlobalFilters />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Hash}
        title="Хэштеги"
        hint={
          <>
            {tags.length} тегов в {taggedCount} операциях
            {totalExpense > 0 && ` · всего ${formatMoney(totalExpense, base)}`}.
            Клик по тегу — операции.
          </>
        }
        right={
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <MousePointerClick className="w-3.5 h-3.5" />
            Кликабельные
          </span>
        }
      />
      <GlobalFilters />

      <div className="card card-pad">
        <div className="font-semibold mb-4">Облако тегов</div>
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => {
            const score = (t.expense + t.income) / maxTotal;
            const fontSize = 12 + Math.round(score * 16);
            return (
              <button
                key={t.tag}
                onClick={() => openTag(t.tag)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-panel2 hover:border-accent hover:bg-accent/10 transition-colors"
                style={{ fontSize }}
              >
                <Hash className="w-3 h-3 text-accent shrink-0" />
                <span className="font-medium">{t.tag}</span>
                <span className="text-muted text-xs tabular-nums">
                  {formatMoney(t.expense + t.income, base)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card card-pad">
        <div className="font-semibold mb-3">Все теги</div>
        <SortableTable<TagBucket>
          data={tags}
          rowKey={(t) => t.tag}
          defaultSortKey="total"
          defaultSortDir="desc"
          onRowClick={(t) => openTag(t.tag)}
          exportName="hashtags"
          columns={
            [
              {
                key: "tag",
                label: "Тег",
                sortValue: (t) => t.tag,
                render: (t) => (
                  <span className="inline-flex items-center gap-1">
                    <Hash className="w-3 h-3 text-accent" />
                    {t.tag}
                  </span>
                ),
              },
              {
                key: "expense",
                label: "Расход",
                align: "right",
                sortValue: (t) => t.expense,
                render: (t) => (
                  <span className="tabular-nums text-expense">
                    {t.expense > 0 ? formatMoney(t.expense, base) : "—"}
                  </span>
                ),
              },
              {
                key: "income",
                label: "Доход",
                align: "right",
                sortValue: (t) => t.income,
                render: (t) => (
                  <span className="tabular-nums text-income">
                    {t.income > 0 ? formatMoney(t.income, base) : "—"}
                  </span>
                ),
              },
              {
                key: "count",
                label: "Операций",
                align: "right",
                sortValue: (t) => t.count,
                render: (t) => <span className="text-muted">{t.count}</span>,
              },
              {
                key: "total",
                label: "Доля от расходов",
                align: "right",
                sortValue: (t) => (totalExpense > 0 ? t.expense / totalExpense : 0),
                render: (t) => (
                  <span className="tabular-nums text-muted">
                    {totalExpense > 0 ? formatPct(t.expense / totalExpense, 1) : "—"}
                  </span>
                ),
              },
            ] as Column<TagBucket>[]
          }
        />
      </div>

      {/* Per-tag expense breakdown by category → subcategory. */}
      <div className="card card-pad">
        <div className="font-semibold mb-3">Расходы по категориям</div>
        <div className="space-y-1">
          {tags.map((t) => {
            const nodes = catTrees.get(t.tag);
            if (!nodes || nodes.length === 0) return null;
            const isOpen = expanded.has(t.tag);
            const tagTotal = nodes.reduce((s, n) => s + n.total, 0);
            return (
              <div key={t.tag} className="border-b border-border/50 last:border-0">
                <button
                  type="button"
                  onClick={() => toggle(t.tag)}
                  className="w-full flex items-center gap-2 py-2 px-1 text-left rounded-md hover:bg-panel2/50"
                >
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 text-muted shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                  )}
                  <Hash className="w-3 h-3 text-accent shrink-0" />
                  <span className="font-medium">{t.tag}</span>
                  <span className="ml-auto tabular-nums text-expense">
                    {formatMoney(tagTotal, base)}
                  </span>
                </button>
                {isOpen && (
                  <div className="pb-2 pl-7 pr-1 space-y-1">
                    {nodes.map((n) => (
                      <div key={n.category}>
                        <div className="flex items-center gap-2 py-0.5 text-sm">
                          <span>{n.category}</span>
                          <span className="ml-auto tabular-nums text-muted">
                            {formatMoney(n.total, base)}
                          </span>
                        </div>
                        {n.subs.length > 0 && (
                          <div className="pl-4 space-y-0.5">
                            {n.subs.map((s) => (
                              <div
                                key={s.name}
                                className="flex items-center gap-2 py-0.5 text-xs text-muted"
                              >
                                <span>{s.name}</span>
                                <span className="ml-auto tabular-nums">
                                  {formatMoney(s.total, base)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
