import { useMemo } from "react";
import { Tag, AlertCircle } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { detectUncategorized } from "../lib/aggregations";
import { formatMoney, formatDate, formatNum } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { SortableTable, type Column } from "../components/SortableTable";
import type { Transaction } from "../types";

export function UncategorizedPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const showDrill = useDrillStore((s) => s.show);

  const list = useMemo(() => detectUncategorized(transactions), [transactions]);
  const total = list.reduce((s, t) => s + t.amountBase, 0);
  const allTotal = transactions
    .filter((t) => t.kind !== "transfer")
    .reduce((s, t) => s + t.amountBase, 0);
  const share = allTotal > 0 ? total / allTotal : 0;

  if (transactions.length === 0) return <EmptyState />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Tag className="w-6 h-6 text-accent" />
          Незакатегоризованные
        </h1>
        <p className="text-muted text-sm mt-1">
          Операции с категориями «Прочие» / «Без категории» / пустыми. Подсветить пробелы для чистки в Дзен-мани.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="card card-pad">
          <div className="label mb-1">Найдено</div>
          <div className="stat-num">{formatNum(list.length)}</div>
          <div className="text-xs text-muted mt-1">из {formatNum(transactions.length)} всего</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Сумма</div>
          <div className="stat-num text-warn">
            {formatMoney(total, base, { compact: true })}
          </div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Доля от всех потоков</div>
          <div className="stat-num">{(share * 100).toFixed(1)}%</div>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <AlertCircle className="w-10 h-10 text-income mx-auto mb-3" />
          <div className="font-medium mb-1">Все операции категоризированы — отлично!</div>
          <div className="text-sm text-muted">
            Не найдено операций с пустыми или «прочими» категориями
          </div>
        </div>
      ) : (
        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">Все незакатегоризованные ({list.length})</div>
            <button
              onClick={() => showDrill("Незакатегоризованные", list, "Чистка категорий")}
              className="btn-ghost text-xs"
            >
              Открыть в drawer
            </button>
          </div>
          <SortableTable<Transaction>
            data={list}
            rowKey={(t) => t.id}
            defaultSortKey="date"
            defaultSortDir="desc"
            limit={200}
            columns={
              [
                {
                  key: "date",
                  label: "Дата",
                  sortValue: (t) => t.date,
                  render: (t) => (
                    <span className="whitespace-nowrap text-muted">
                      {formatDate(t.date, "short")}
                    </span>
                  ),
                },
                {
                  key: "category",
                  label: "Категория",
                  sortValue: (t) => t.categoryFull,
                  render: (t) => (
                    <span className="truncate max-w-[150px] inline-block text-warn">
                      {t.categoryFull || "—"}
                    </span>
                  ),
                },
                {
                  key: "payee",
                  label: "Получатель",
                  sortValue: (t) => t.payee || "",
                  render: (t) => (
                    <span className="truncate max-w-[160px] inline-block">
                      {t.payee || "—"}
                    </span>
                  ),
                },
                {
                  key: "comment",
                  label: "Комментарий",
                  sortValue: (t) => t.comment,
                  render: (t) => (
                    <span
                      className="truncate max-w-[280px] inline-block text-xs text-muted"
                      title={t.comment}
                    >
                      {t.comment}
                    </span>
                  ),
                },
                {
                  key: "amount",
                  label: "Сумма",
                  align: "right",
                  sortValue: (t) => t.amountBase,
                  render: (t) => (
                    <span
                      className={`tabular-nums whitespace-nowrap ${
                        t.kind === "income" ? "text-income" : "text-expense"
                      }`}
                    >
                      {t.kind === "income" ? "+" : "−"}
                      {formatMoney(t.amount, t.currency)}
                    </span>
                  ),
                },
              ] as Column<Transaction>[]
            }
          />
        </div>
      )}
    </div>
  );
}
