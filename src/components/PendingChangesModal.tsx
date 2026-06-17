import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { CloudOff, X, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore, type TransactionEdit } from "../store/useEditsStore";
import { useDraftsStore } from "../store/useDraftsStore";
import { useDeletedStore } from "../store/useDeletedStore";
import { confirm } from "../store/useConfirmStore";
import { CategoryDot } from "./CategoryDot";
import { formatMoney } from "../lib/format";
import { kindLabel } from "../lib/txKindStyle";
import type { Transaction } from "../types";

// Which patch fields map to which human-readable «changed aspect».
const FIELD_LABEL: Record<string, string> = {
  date: "дата",
  createdAt: "время",
  category: "категория",
  subcategory: "категория",
  categoryFull: "категория",
  payee: "получатель",
  brand: "получатель",
  comment: "комментарий",
  amount: "сумма",
  currency: "валюта",
  account: "счёт",
  outcomeAccount: "счёт",
  incomeAccount: "счёт",
  incomeAmount: "сумма",
  incomeCurrency: "валюта",
  kind: "тип",
};

function changedAspects(patch: TransactionEdit): string {
  const set = new Set<string>();
  for (const k of Object.keys(patch)) {
    const label = FIELD_LABEL[k];
    if (label) set.add(label);
  }
  return [...set].join(", ");
}

/**
 * Local pending changes that haven't been pushed to Zenmoney yet — edits,
 * newly-created drafts, and local deletions. Each can be reverted (rolled back)
 * individually, or all at once. Purely local: reverting never touches the cloud.
 */
export function PendingChangesModal({ onClose }: { onClose: () => void }) {
  const transactions = useDataStore((s) => s.transactions);
  const transactionsRaw = useDataStore((s) => s.transactionsRaw);
  const reapply = useDataStore((s) => s.reapplyRules);
  const deleteTransaction = useDataStore((s) => s.deleteTransaction);

  const edits = useEditsStore((s) => s.edits);
  const clearEdit = useEditsStore((s) => s.clearEdit);
  const clearAllEdits = useEditsStore((s) => s.clearAll);
  const drafts = useDraftsStore((s) => s.drafts);
  const clearAllDrafts = useDraftsStore((s) => s.clearAll);
  const deletedIds = useDeletedStore((s) => s.deletedIds);
  const restoreDeleted = useDeletedStore((s) => s.restore);
  const restoreManyDeleted = useDeletedStore((s) => s.restoreMany);

  const backdropDown = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const byId = useMemo(
    () => new Map(transactions.map((t) => [t.id, t])),
    [transactions]
  );
  const rawById = useMemo(
    () => new Map(transactionsRaw.map((t) => [t.id, t])),
    [transactionsRaw]
  );

  const editItems = useMemo(
    () =>
      Object.keys(edits)
        .map((id) => ({ id, tx: byId.get(id), patch: edits[id] }))
        .filter((x): x is { id: string; tx: Transaction; patch: TransactionEdit } => !!x.tx),
    [edits, byId]
  );
  const draftItems = useMemo(
    () => Object.keys(drafts).map((id) => byId.get(id)).filter((t): t is Transaction => !!t),
    [drafts, byId]
  );
  const deletedItems = useMemo(
    () => deletedIds.map((id) => rawById.get(id)).filter((t): t is Transaction => !!t),
    [deletedIds, rawById]
  );

  const total = editItems.length + draftItems.length + deletedItems.length;

  async function revertAll() {
    const ok = await confirm({
      title: "Откатить все изменения?",
      message: `${total} несинхронизированных изменений будут отменены локально (правки, черновики, удаления). В облаке Дзен-мани ничего не тронется.`,
      confirmLabel: "Откатить все",
      tone: "danger",
    });
    if (!ok) return;
    await clearAllEdits();
    await clearAllDrafts();
    if (deletedIds.length) await restoreManyDeleted(deletedIds);
    await reapply();
  }

  const label = (t: Transaction) =>
    t.brand?.trim() || t.payee?.trim() || t.categoryFull || "—";

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => {
        backdropDown.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropDown.current) onClose();
        backdropDown.current = false;
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-2xl max-h-[85vh] flex flex-col"
        style={{ scrollbarGutter: "stable" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="font-semibold flex items-center gap-2">
            <CloudOff className="w-4 h-4 text-muted" />
            Несинхронизированные изменения
            <span className="text-muted font-normal">({total})</span>
          </div>
          <div className="flex items-center gap-2">
            {total > 0 && (
              <button
                onClick={revertAll}
                className="btn-ghost text-xs text-expense whitespace-nowrap"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Откатить все
              </button>
            )}
            <button onClick={onClose} className="text-muted hover:text-text" aria-label="Закрыть">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-3 flex-1">
          {total === 0 ? (
            <div className="text-center text-muted text-sm py-10">
              Нет несинхронизированных изменений — всё отправлено в Дзен-мани.
            </div>
          ) : (
            <div className="space-y-5">
              {draftItems.length > 0 && (
                <Section
                  icon={<Plus className="w-3.5 h-3.5 text-income" />}
                  title="Создано"
                  count={draftItems.length}
                >
                  {draftItems.map((t) => (
                    <Row
                      key={t.id}
                      t={t}
                      label={label(t)}
                      action="Удалить"
                      onAction={() => deleteTransaction(t.id)}
                    />
                  ))}
                </Section>
              )}

              {editItems.length > 0 && (
                <Section
                  icon={<Pencil className="w-3.5 h-3.5 text-accent2" />}
                  title="Изменено"
                  count={editItems.length}
                >
                  {editItems.map(({ id, tx, patch }) => (
                    <Row
                      key={id}
                      t={tx}
                      label={label(tx)}
                      note={changedAspects(patch)}
                      action="Откатить"
                      onAction={async () => {
                        await clearEdit(id);
                        await reapply();
                      }}
                    />
                  ))}
                </Section>
              )}

              {deletedItems.length > 0 && (
                <Section
                  icon={<Trash2 className="w-3.5 h-3.5 text-expense" />}
                  title="Удалено"
                  count={deletedItems.length}
                >
                  {deletedItems.map((t) => (
                    <Row
                      key={t.id}
                      t={t}
                      label={label(t)}
                      action="Вернуть"
                      onAction={async () => {
                        await restoreDeleted(t.id);
                        await reapply();
                      }}
                    />
                  ))}
                </Section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted mb-1">
        {icon}
        {title}
        <span className="opacity-60">({count})</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({
  t,
  label,
  note,
  action,
  onAction,
}: {
  t: Transaction;
  label: string;
  note?: string;
  action: string;
  onAction: () => void | Promise<void>;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-t border-border/40 first:border-t-0 text-sm">
      <CategoryDot category={t.category} size="w-4 h-4" />
      <div className="min-w-0 flex-1">
        <div className="truncate" title={label}>
          {label}
        </div>
        <div className="text-[11px] text-muted truncate">
          {t.categoryFull}
          {note ? ` · изменено: ${note}` : ""}
        </div>
      </div>
      <span className="tabular-nums whitespace-nowrap text-muted">
        {kindLabel(t.kind)} · {formatMoney(t.amount, t.currency)}
      </span>
      <button
        onClick={() => void onAction()}
        className="btn-ghost text-xs whitespace-nowrap shrink-0"
        title={`${action} (локально, без облака)`}
      >
        <Undo2 className="w-3.5 h-3.5" />
        {action}
      </button>
    </div>
  );
}
