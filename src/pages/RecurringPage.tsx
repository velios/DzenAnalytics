import { useMemo } from "react";
import { Repeat, Calendar, AlertCircle } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { detectRecurring, type RecurringCandidate } from "../lib/aggregations";
import { formatMoney, formatDate, formatNum } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { SortableTable, type Column } from "../components/SortableTable";

export function RecurringPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const showDrill = useDrillStore((s) => s.show);

  const candidates = useMemo(() => detectRecurring(transactions), [transactions]);

  if (transactions.length === 0) return <EmptyState />;

  const totalMonthly = candidates.reduce((s, c) => {
    if (c.avgIntervalDays > 0) return s + (c.avgAmount * 30) / c.avgIntervalDays;
    return s;
  }, 0);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = candidates.filter((c) => c.nextExpected >= today).sort((a, b) => a.nextExpected.localeCompare(b.nextExpected));

  function openCandidate(c: { txIds: string[]; payee: string }) {
    const txs = transactions.filter((t) => c.txIds.includes(t.id));
    showDrill(c.payee, txs, "Регулярные платежи");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Repeat className="w-6 h-6 text-accent" />
          Регулярные платежи
        </h1>
        <p className="text-muted text-sm mt-1">
          Автодетект подписок и регулярных трат: одинаковый получатель, ~стабильная сумма,
          интервал 5–95 дней, минимум 3 повтора. Глобальные фильтры тут не применяются —
          анализируется вся история.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card card-pad">
          <div className="label mb-1">Найдено</div>
          <div className="stat-num">{candidates.length}</div>
          <div className="text-xs text-muted mt-1">регулярных платежей</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">≈ в месяц</div>
          <div className="stat-num text-warn">
            {formatMoney(totalMonthly, base, { compact: true })}
          </div>
          <div className="text-xs text-muted mt-1">оценка нагрузки</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">≈ в год</div>
          <div className="stat-num text-warn">
            {formatMoney(totalMonthly * 12, base, { compact: true })}
          </div>
          <div className="text-xs text-muted mt-1">экстраполяция</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Ожидаются</div>
          <div className="stat-num">{upcoming.length}</div>
          <div className="text-xs text-muted mt-1">в ближайшие платежи</div>
        </div>
      </div>

      {candidates.length === 0 && (
        <div className="card card-pad text-center py-12">
          <AlertCircle className="w-10 h-10 text-muted mx-auto mb-3" />
          <div className="font-medium mb-1">Регулярных платежей не найдено</div>
          <div className="text-sm text-muted">
            Нужно минимум 3 повтора одного получателя с интервалом ~раз в месяц.
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="card card-pad">
          <div className="font-semibold mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-accent" />
            Ближайшие ожидаемые
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {upcoming.slice(0, 6).map((c) => {
              const daysUntil = Math.round(
                (+new Date(c.nextExpected) - +new Date(today)) / 86400000
              );
              return (
                <button
                  key={c.payee + c.currency}
                  onClick={() => openCandidate(c)}
                  className="text-left p-3 rounded-lg bg-panel2 border border-border hover:border-accent transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-medium text-sm truncate">{c.payee}</div>
                    <div className="text-xs pill shrink-0 ml-2">
                      {daysUntil === 0 ? "сегодня" : `через ${daysUntil} дн.`}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>{formatDate(c.nextExpected, "short")}</span>
                    <span className="text-expense font-semibold tabular-nums">
                      ≈ {formatMoney(c.avgAmount, c.currency, { compact: true })}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {candidates.length > 0 && (
        <div className="card card-pad">
          <div className="font-semibold mb-3">Все регулярные платежи</div>
          <SortableTable<RecurringCandidate>
            data={candidates}
            rowKey={(c) => c.payee + c.currency}
            defaultSortKey="totalSpent"
            defaultSortDir="desc"
            onRowClick={openCandidate}
            exportName="recurring_payments"
            columns={
              [
                {
                  key: "payee",
                  label: "Получатель",
                  sortValue: (c) => c.payee,
                  render: (c) => (
                    <span className="font-medium truncate max-w-[180px] inline-block" title={c.payee}>
                      {c.payee}
                    </span>
                  ),
                },
                {
                  key: "category",
                  label: "Категория",
                  sortValue: (c) => c.category,
                  render: (c) => (
                    <span className="text-muted truncate max-w-[120px] inline-block">
                      {c.category}
                    </span>
                  ),
                },
                {
                  key: "avgAmount",
                  label: "Сумма ср.",
                  align: "right",
                  sortValue: (c) => c.avgAmount,
                  render: (c) => (
                    <span className="tabular-nums">
                      {formatMoney(c.avgAmount, c.currency, { compact: true })}
                    </span>
                  ),
                },
                {
                  key: "avgInterval",
                  label: "Раз в",
                  align: "right",
                  sortValue: (c) => c.avgIntervalDays,
                  render: (c) => <span className="text-muted">{c.avgIntervalDays} дн</span>,
                },
                {
                  key: "occurrences",
                  label: "Повторов",
                  align: "right",
                  sortValue: (c) => c.occurrences,
                  render: (c) => <span className="text-muted">{formatNum(c.occurrences)}</span>,
                },
                {
                  key: "consistency",
                  label: "Стабильность",
                  align: "right",
                  sortValue: (c) => c.consistency,
                  render: (c) => (
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-12 h-1.5 bg-panel2 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent"
                          style={{ width: `${c.consistency * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted tabular-nums w-10 text-right">
                        {(c.consistency * 100).toFixed(0)}%
                      </span>
                    </div>
                  ),
                },
                {
                  key: "lastDate",
                  label: "Последний",
                  sortValue: (c) => c.lastDate,
                  render: (c) => (
                    <span className="text-muted whitespace-nowrap">
                      {formatDate(c.lastDate, "short")}
                    </span>
                  ),
                },
                {
                  key: "nextExpected",
                  label: "Следующий",
                  sortValue: (c) => c.nextExpected,
                  render: (c) => (
                    <span className="text-muted whitespace-nowrap">
                      {formatDate(c.nextExpected, "short")}
                    </span>
                  ),
                },
                {
                  key: "totalSpent",
                  label: "Итого",
                  align: "right",
                  sortValue: (c) => c.totalSpent,
                  render: (c) => (
                    <span className="tabular-nums text-expense font-medium">
                      {formatMoney(c.totalSpent, c.currency, { compact: true })}
                    </span>
                  ),
                },
              ] as Column<RecurringCandidate>[]
            }
          />
        </div>
      )}
    </div>
  );
}
