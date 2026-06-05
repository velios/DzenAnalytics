import { useMemo } from "react";
import { Trash2, RotateCcw, Undo2, Info } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore } from "../store/useEditsStore";
import { useDeletedStore } from "../store/useDeletedStore";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { applyEdits } from "../lib/applyEdits";
import {
  formatMoney,
  formatDate,
  formatNum,
  displayPayee,
  secondaryPayee,
} from "../lib/format";
import { kindColorClass, kindGlyphClass, kindSignGlyph } from "../lib/txKindStyle";
import { CategoryDot } from "../components/CategoryDot";
import { PageHeader } from "../components/PageHeader";

/**
 * «Корзина» — locally-deleted (hidden) transactions and a way to bring
 * them back. Deleting is a soft, reversible operation: the row stays in
 * `transactionsRaw`, only hidden from every view via `useDeletedStore`.
 * Here we re-surface those hidden rows (with the user's edits applied on
 * top) and let them be restored one-by-one or all at once.
 */
export function TrashPage() {
  const transactionsRaw = useDataStore((s) => s.transactionsRaw);
  const rates = useDataStore((s) => s.rates);
  const restoreTransaction = useDataStore((s) => s.restoreTransaction);
  const restoreTransactionMany = useDataStore((s) => s.restoreTransactionMany);
  const edits = useEditsStore((s) => s.edits);
  const deletedSet = useDeletedStore((s) => s.deletedSet);
  const pushMode = useZenmoneyStore((s) => s.pushMode);

  // Hidden rows = the raw pipeline output (with edits applied) intersected
  // with the deleted-id set, newest first.
  const deletedTxs = useMemo(() => {
    if (deletedSet.size === 0) return [];
    const withEdits = applyEdits(transactionsRaw, edits, rates);
    return withEdits
      .filter((t) => deletedSet.has(t.id))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [transactionsRaw, edits, rates, deletedSet]);

  if (deletedTxs.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={Trash2}
          title="Удалённые"
          hint="Удалённые операции скрыты из всех расчётов, но хранятся локально — здесь их можно вернуть."
        />
        <div className="card card-pad text-center py-16">
          <Trash2 className="w-10 h-10 text-muted mx-auto mb-3" />
          <div className="font-medium mb-1">Корзина пуста</div>
          <div className="text-sm text-muted">
            Удалённых операций нет. Удалить операцию можно иконкой 🗑️ в ленте
            «Операции» или в карточке операции.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Trash2}
        title="Удалённые"
        hint="Удалённые операции скрыты из всех расчётов, но хранятся локально — здесь их можно вернуть."
        right={
          <button
            onClick={() => restoreTransactionMany(deletedTxs.map((t) => t.id))}
            className="btn-ghost text-sm"
          >
            <Undo2 className="w-4 h-4" />
            Восстановить все ({formatNum(deletedTxs.length)})
          </button>
        }
      />

      {pushMode !== "off" && (
        <div className="card card-pad bg-accent/5 border-accent/40 flex items-start gap-2 text-sm">
          <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <span className="text-muted">
            Включена двусторонняя синхронизация: восстановление вернёт операцию
            <strong> и в облако Дзен-мани</strong> — она будет создана заново при
            следующей отправке/синхронизации (со всеми полями: получатель, теги,
            суммы).
          </span>
        </div>
      )}

      <div className="card card-pad">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold flex items-center gap-2">
            <Trash2 className="w-4 h-4" />
            Удалённые операции ({formatNum(deletedTxs.length)})
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted text-left">
                <th className="font-normal py-2 pr-2">Дата</th>
                <th className="font-normal py-2 px-2">Категория</th>
                <th className="font-normal py-2 px-2">Получатель</th>
                <th className="font-normal py-2 px-2">Комментарий</th>
                <th className="font-normal py-2 px-2">Счёт</th>
                <th className="font-normal py-2 px-2 text-right">Сумма</th>
                <th className="font-normal py-2 pl-2 text-right">Действие</th>
              </tr>
            </thead>
            <tbody>
              {deletedTxs.map((t) => {
                const primary = displayPayee(t) || "";
                const secondary = secondaryPayee(t);
                return (
                  <tr key={t.id} className="border-t border-border align-top">
                    <td className="py-2 pr-2 whitespace-nowrap text-muted">
                      {formatDate(t.date, "short")}
                    </td>
                    <td className="py-2 px-2 max-w-[180px]">
                      <div className="truncate flex items-center gap-2" title={t.categoryFull}>
                        <CategoryDot category={t.category} size="w-5 h-5" />
                        <span className="truncate">{t.category || "—"}</span>
                      </div>
                      {t.subcategory && (
                        <div className="text-xs text-muted truncate pl-7">
                          {t.subcategory}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2 max-w-[180px]">
                      <div className="truncate" title={primary}>
                        {primary || <span className="text-muted">—</span>}
                      </div>
                      {secondary && (
                        <div className="truncate text-[10px] text-muted/80" title={secondary}>
                          {secondary}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2 max-w-[260px] text-xs text-muted">
                      <div className="line-clamp-2" title={t.comment}>
                        {t.comment || ""}
                      </div>
                    </td>
                    <td className="py-2 px-2 max-w-[140px] truncate text-muted text-xs" title={t.account}>
                      {t.account}
                    </td>
                    <td
                      className={`py-2 px-2 text-right tabular-nums font-medium whitespace-nowrap ${kindColorClass(t.kind)}`}
                    >
                      <span className={kindGlyphClass(t.kind)}>{kindSignGlyph(t.kind)}</span>
                      {formatMoney(t.amount, t.currency)}
                    </td>
                    <td className="py-2 pl-2 text-right">
                      <button
                        onClick={() => restoreTransaction(t.id)}
                        className="btn-ghost text-xs !py-1 whitespace-nowrap"
                        title="Восстановить операцию"
                        aria-label="Восстановить операцию"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Восстановить
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
