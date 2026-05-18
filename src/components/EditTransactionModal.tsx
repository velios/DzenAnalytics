import { useEffect, useMemo, useState } from "react";
import { Pencil, RotateCcw, Save, X } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore } from "../store/useEditsStore";
import { Combobox } from "./Combobox";
import type { Transaction } from "../types";

interface Props {
  tx: Transaction;
  onClose: () => void;
}

/**
 * Modal for editing a single transaction. Writes the patch to the local
 * overlay (`useEditsStore`) — the cloud copy in Zenmoney is never touched.
 * After save we re-run the local pipeline so derived fields stay consistent.
 */
export function EditTransactionModal({ tx, onClose }: Props) {
  const rates = useDataStore((s) => s.rates);
  const allTransactions = useDataStore((s) => s.transactions);
  const reapply = useDataStore((s) => s.reapplyRules);
  const setEdit = useEditsStore((s) => s.setEdit);
  const clearEdit = useEditsStore((s) => s.clearEdit);
  const existing = useEditsStore((s) => s.edits[tx.id]);
  const hasEdit = !!existing;

  // Categories used by income transactions and those used by expenses are
  // typically disjoint. Filter the suggestions by the current transaction's
  // kind so income-only categories don't show up when editing an expense and
  // vice versa.
  const { categoryOptions, subcatByCategory } = useMemo(() => {
    const cats = new Set<string>();
    const subByCat = new Map<string, Set<string>>();
    for (const t of allTransactions) {
      // For transfers we don't filter — they're rare and the user might want
      // any label. For income/expense, only collect from same-kind txs.
      if (tx.kind !== "transfer" && t.kind !== tx.kind) continue;
      if (!t.category) continue;
      cats.add(t.category);
      if (t.subcategory) {
        let bucket = subByCat.get(t.category);
        if (!bucket) {
          bucket = new Set<string>();
          subByCat.set(t.category, bucket);
        }
        bucket.add(t.subcategory);
      }
    }
    return {
      categoryOptions: Array.from(cats).sort((a, b) => a.localeCompare(b, "ru")),
      subcatByCategory: subByCat,
    };
  }, [allTransactions, tx.kind]);

  const [date, setDate] = useState(tx.date);
  const [category, setCategory] = useState(tx.category);
  const [subcategory, setSubcategory] = useState(tx.subcategory ?? "");
  const [payee, setPayee] = useState(tx.payee);
  const [comment, setComment] = useState(tx.comment);
  const [amount, setAmount] = useState(String(tx.amount));
  const [currency, setCurrency] = useState(tx.currency);
  const [account, setAccount] = useState(tx.account);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setSaving(true);
    try {
      const amtNum = Number(amount.replace(",", "."));
      const patch = {
        date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : tx.date,
        category: category.trim() || tx.category,
        subcategory: subcategory.trim() || null,
        payee: payee.trim(),
        comment: comment.trim(),
        amount: Number.isFinite(amtNum) && amtNum >= 0 ? amtNum : tx.amount,
        currency: currency.trim() || tx.currency,
        account: account.trim() || tx.account,
      };
      await setEdit(tx.id, patch);
      await reapply();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!hasEdit) return;
    setSaving(true);
    try {
      await clearEdit(tx.id);
      await reapply();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const currencyOptions = Array.from(
    new Set([currency, ...Object.keys(rates.rates)])
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="font-semibold flex items-center gap-2">
            <Pencil className="w-4 h-4 text-accent2" />
            Редактирование операции
          </div>
          <button onClick={onClose} className="text-muted hover:text-text">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Дата (ГГГГ-ММ-ДД)">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input text-sm w-full"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Категория">
              <Combobox
                value={category}
                options={categoryOptions}
                onChange={(next) => {
                  setCategory(next);
                  // Reset subcategory if it doesn't belong to the new parent.
                  if (
                    subcategory &&
                    !subcatByCategory.get(next)?.has(subcategory)
                  ) {
                    setSubcategory("");
                  }
                }}
              />
            </Field>
            <Field label="Подкатегория">
              <Combobox
                value={subcategory}
                options={Array.from(subcatByCategory.get(category) || []).sort(
                  (a, b) => a.localeCompare(b, "ru")
                )}
                onChange={setSubcategory}
                placeholder="—"
              />
            </Field>
          </div>
          <Field label="Получатель">
            <input
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              className="input text-sm w-full"
            />
          </Field>
          <Field label="Комментарий">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              className="input text-sm w-full resize-y"
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Сумма">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="input text-sm w-full font-mono tabular-nums"
              />
            </Field>
            <Field label="Валюта">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="input text-sm w-full"
              >
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Тип">
              <div className="input text-sm w-full bg-panel2 text-muted">
                {tx.kind === "income"
                  ? "доход"
                  : tx.kind === "expense"
                    ? "расход"
                    : "перевод"}
              </div>
            </Field>
          </div>
          <Field label="Счёт">
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              className="input text-sm w-full"
            />
          </Field>
          <p className="text-[11px] text-muted">
            Правки сохраняются локально как overlay поверх данных. Следующая
            синхронизация с API их не затрёт. Изменить тип операции
            (доход/расход/перевод) пока нельзя.
          </p>
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border">
          {hasEdit ? (
            <button
              onClick={reset}
              disabled={saving}
              className="btn-ghost text-xs text-muted"
              title="Откатить к исходному значению"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Сбросить правку
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-ghost text-sm">
              Отмена
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="btn-primary text-sm"
            >
              <Save className="w-3.5 h-3.5" />
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label block mb-1">{label}</label>
      {children}
    </div>
  );
}
