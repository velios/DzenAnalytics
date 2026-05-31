import { useMemo, useState } from "react";
import { Copy, AlertCircle, Pencil } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useEditsStore } from "../store/useEditsStore";
import type { TransactionEdit } from "../store/useEditsStore";
import { detectDuplicates } from "../lib/aggregations";
import { formatMoney, formatDate, formatNum } from "../lib/format";
import { kindColorClass, kindGlyphClass, kindLabel, kindSignGlyph } from "../lib/txKindStyle";
import { EmptyState } from "../components/EmptyState";
import { BulkEditModal } from "../components/BulkEditModal";

export function DuplicatesPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const reapplyRules = useDataStore((s) => s.reapplyRules);
  const setEditMany = useEditsStore((s) => s.setEditMany);
  const showDrill = useDrillStore((s) => s.show);

  const [windowDays, setWindowDays] = useState(3);
  const groups = useMemo(
    () => detectDuplicates(transactions, windowDays),
    [transactions, windowDays]
  );

  // ── Bulk selection + edit (global across all duplicate groups) ──────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulk(patch: TransactionEdit) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    await setEditMany(ids, patch);
    await reapplyRules();
    setSelected(new Set());
    setBulkOpen(false);
  }

  // Reset selection when the detected groups change (window / data).
  const [prevGroups, setPrevGroups] = useState(groups);
  if (groups !== prevGroups) {
    setPrevGroups(groups);
    if (selected.size > 0) setSelected(new Set());
  }

  if (transactions.length === 0) return <EmptyState />;

  const totalDuplicateAmount = groups.reduce(
    (s, g) => s + g.totalAmount - g.txs[0].amountBase,
    0
  );
  const totalCount = groups.reduce((s, g) => s + g.txs.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Copy className="w-6 h-6 text-warn" />
            Дубликаты
          </h1>
          <p className="text-muted text-sm mt-1">
            Подозрительно похожие операции: одинаковая сумма, тот же получатель и тот же тип в
            пределах окна. Часто бывают при двойном импорте.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Окно (дней)</span>
          <input
            type="range"
            min="1"
            max="14"
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="accent-accent"
          />
          <span className="text-xs tabular-nums w-6">{windowDays}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="card card-pad">
          <div className="label mb-1">Групп дубликатов</div>
          <div className="stat-num text-warn">{groups.length}</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Всего операций в группах</div>
          <div className="stat-num">{formatNum(totalCount)}</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Лишняя сумма</div>
          <div className="stat-num text-expense">
            {formatMoney(totalDuplicateAmount, base, { decimals: 0 })}
          </div>
          <div className="text-xs text-muted mt-1">
            если все «лишние» копии — действительно дубли
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <AlertCircle className="w-10 h-10 text-muted mx-auto mb-3" />
          <div className="font-medium mb-1">Дубликатов не найдено</div>
          <div className="text-sm text-muted">
            В окне ±{windowDays} дн нет подозрительно похожих операций
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g, i) => {
            const first = g.txs[0];
            const groupAll = g.txs.length > 0 && g.txs.every((t) => selected.has(t.id));
            const groupSome = g.txs.some((t) => selected.has(t.id)) && !groupAll;
            const toggleGroup = () =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (groupAll) g.txs.forEach((t) => next.delete(t.id));
                else g.txs.forEach((t) => next.add(t.id));
                return next;
              });
            return (
              <div key={i} className="card card-pad">
                <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {first.payee || first.categoryFull}
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      {kindLabel(first.kind).replace(/^./, (c) => c.toUpperCase())} ·{" "}
                      {first.categoryFull} ·{" "}
                      {formatMoney(first.amount, first.currency)} ·{" "}
                      {g.txs.length} копий
                    </div>
                  </div>
                  <button
                    onClick={() => showDrill(first.payee || first.categoryFull, g.txs, "Дубликаты")}
                    className="btn-ghost text-xs"
                  >
                    Открыть в drawer
                  </button>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="table-th w-8">
                        <input
                          type="checkbox"
                          className="accent-accent w-4 h-4 align-middle"
                          checked={groupAll}
                          ref={(el) => {
                            if (el) el.indeterminate = groupSome;
                          }}
                          onChange={toggleGroup}
                          title="Выбрать всю группу"
                          aria-label="Выбрать все операции группы"
                        />
                      </th>
                      <th className="table-th">Дата</th>
                      <th className="table-th">Категория</th>
                      <th className="table-th">Комментарий</th>
                      <th className="table-th">Счёт</th>
                      <th className="table-th text-right">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.txs.map((t) => {
                      const isSel = selected.has(t.id);
                      return (
                      <tr
                        key={t.id}
                        className={isSel ? "bg-accent/5" : "hover:bg-panel2/40"}
                      >
                        <td className="table-td w-8">
                          <input
                            type="checkbox"
                            className="accent-accent w-4 h-4 align-middle"
                            checked={isSel}
                            onChange={() => toggleSelect(t.id)}
                            aria-label="Выбрать операцию"
                          />
                        </td>
                        <td className="table-td whitespace-nowrap text-muted">
                          {formatDate(t.date, "short")}
                        </td>
                        <td className="table-td truncate max-w-[160px]">
                          {t.categoryFull}
                        </td>
                        <td
                          className="table-td truncate max-w-[260px] text-xs text-muted"
                          title={t.comment}
                        >
                          {t.comment}
                        </td>
                        <td className="table-td truncate max-w-[120px] text-xs text-muted">
                          {t.account}
                        </td>
                        <td
                          className={`table-td text-right tabular-nums whitespace-nowrap ${kindColorClass(t.kind)}`}
                          title={t.kind === "refund" ? "Возврат — уменьшает расход категории" : undefined}
                        >
                          <span className={kindGlyphClass(t.kind)}>{kindSignGlyph(t.kind)}</span>
                          {formatMoney(t.amount, t.currency)}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating bulk-action bar — appears when ≥1 row is selected. */}
      {selected.size > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border bg-panel shadow-xl">
          <span className="text-sm">
            Выбрано: <strong className="tabular-nums">{formatNum(selected.size)}</strong>
          </span>
          <button onClick={() => setBulkOpen(true)} className="btn-primary text-sm">
            <Pencil className="w-3.5 h-3.5" />
            Изменить
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="btn-ghost text-sm text-muted"
          >
            Снять выделение
          </button>
        </div>
      )}

      {bulkOpen && (
        <BulkEditModal
          count={selected.size}
          allTransactions={transactions}
          onApply={applyBulk}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </div>
  );
}
