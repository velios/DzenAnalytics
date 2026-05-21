import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, RotateCcw, Save, X, TrendingUp, TrendingDown, ArrowLeftRight } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore } from "../store/useEditsStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { Combobox } from "./Combobox";
import type { Transaction, TxKind } from "../types";

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

  const [kind, setKind] = useState<TxKind>(tx.kind);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const metaLoaded = useCategoryMetaStore((s) => s.loaded);
  const hydrateMeta = useCategoryMetaStore((s) => s.hydrate);
  useEffect(() => {
    if (!metaLoaded) hydrateMeta();
  }, [metaLoaded, hydrateMeta]);

  // Build the category list shown to the user. Priority:
  //   1. If Zenmoney `categoryMeta` is populated (API mode), filter by the
  //      tag's declared `showIncome` / `showOutcome` flags — that's the
  //      canonical "which categories belong to this side" answer.
  //   2. Otherwise (CSV mode, no meta), fall back to the heuristic that
  //      inspects observed transactions of the matching kind.
  // Subcategories always come from observed data — Zenmoney's tag hierarchy
  // isn't fully exposed here, so the heuristic is the best we can do.
  const { categoryOptions, subcatByCategory } = useMemo(() => {
    const subByCat = new Map<string, Set<string>>();
    for (const t of allTransactions) {
      if (!t.category || !t.subcategory) continue;
      let bucket = subByCat.get(t.category);
      if (!bucket) {
        bucket = new Set<string>();
        subByCat.set(t.category, bucket);
      }
      bucket.add(t.subcategory);
    }

    // 1) API-flagged categories first.
    const metaKeys = Object.keys(categoryMeta);
    const hasFlags = metaKeys.some(
      (k) =>
        categoryMeta[k]?.showIncome !== undefined ||
        categoryMeta[k]?.showOutcome !== undefined
    );
    if (hasFlags && kind !== "transfer") {
      const flagField = kind === "income" ? "showIncome" : "showOutcome";
      const cats = metaKeys.filter((name) => categoryMeta[name]?.[flagField]);
      return {
        categoryOptions: cats.sort((a, b) => a.localeCompare(b, "ru")),
        subcatByCategory: subByCat,
      };
    }

    // 2) Fallback — derive from observed transactions of this kind.
    const cats = new Set<string>();
    for (const t of allTransactions) {
      if (kind !== "transfer" && t.kind !== kind) continue;
      if (!t.category) continue;
      cats.add(t.category);
    }
    return {
      categoryOptions: Array.from(cats).sort((a, b) => a.localeCompare(b, "ru")),
      subcatByCategory: subByCat,
    };
  }, [allTransactions, kind, categoryMeta]);

  // Payee suggestions: every non-empty payee that's appeared in user's data.
  // Sorted by frequency desc, so the names you use most often surface first
  // when you open the dropdown with an empty query.
  const payeeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of allTransactions) {
      const p = t.payee?.trim();
      if (!p) continue;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
      .map(([p]) => p);
  }, [allTransactions]);

  // All account names ever used in the dataset (debit / cash / credit /
  // debt — anything that's appeared either as `account`, `outcomeAccount`
  // or `incomeAccount`). Sorted alphabetically.
  const accountOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTransactions) {
      if (t.account) set.add(t.account);
      if (t.outcomeAccount) set.add(t.outcomeAccount);
      if (t.incomeAccount) set.add(t.incomeAccount);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [allTransactions]);

  const [date, setDate] = useState(tx.date);
  const [category, setCategory] = useState(tx.category);
  const [subcategory, setSubcategory] = useState(tx.subcategory ?? "");
  const [payee, setPayee] = useState(tx.payee);
  const [comment, setComment] = useState(tx.comment);
  const [amount, setAmount] = useState(String(tx.amount));
  const [currency, setCurrency] = useState(tx.currency);
  const [account, setAccount] = useState(tx.account);
  // Transfer-specific: outcome / income accounts. For income/expense we
  // hide these and rely on the single `account` field above.
  const [outAcc, setOutAcc] = useState(tx.outcomeAccount || tx.account);
  const [inAcc, setInAcc] = useState(tx.incomeAccount || "");
  const [saving, setSaving] = useState(false);

  // Tracks whether the most recent mousedown landed on the backdrop. Used
  // by the click handler to decide whether to close — drags that started
  // inside the modal but happened to release on the backdrop must NOT
  // count as a backdrop click.
  const backdropMouseDownRef = useRef(false);

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
      const safeAmount =
        Number.isFinite(amtNum) && amtNum >= 0 ? amtNum : tx.amount;
      const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : tx.date;

      // Build the patch differently depending on the (possibly new) kind.
      // For transfers we have to keep both legs consistent: `account`
      // shadows the source (matches the original mapper convention),
      // `outcomeAccount` + `incomeAccount` carry the actual pair.
      const patch: Record<string, unknown> = {
        date: safeDate,
        category: category.trim() || tx.category,
        subcategory: subcategory.trim() || null,
        payee: payee.trim(),
        comment: comment.trim(),
        amount: safeAmount,
        currency: currency.trim() || tx.currency,
        kind,
      };
      if (kind === "transfer") {
        const src = outAcc.trim() || tx.outcomeAccount || tx.account;
        const dst = inAcc.trim() || tx.incomeAccount || "";
        patch.outcomeAccount = src;
        patch.incomeAccount = dst;
        patch.account = src; // mapper convention: transfer rows live under source
      } else {
        patch.account = account.trim() || tx.account;
        // Keep outcome/income aligned with the selected kind so charts
        // that look at those fields directly don't see stale data.
        if (kind === "income") {
          patch.incomeAccount = account.trim() || tx.account;
          patch.outcomeAccount = "";
        } else {
          patch.outcomeAccount = account.trim() || tx.account;
          patch.incomeAccount = "";
        }
      }

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

  // Tight dropdown ceiling for these comboboxes. The default `min(50vh,
  // 320px)` is too generous when several comboboxes share a single modal
  // — opening one would push the controls below offscreen on smaller
  // viewports. 240px ≈ 8 visible rows, plenty for browsing.
  const DROPDOWN_MAX = "min(38vh, 240px)";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      // Only treat as "click on backdrop" when both press AND release
      // happened on the backdrop itself. Otherwise a mousedown inside
      // the modal (e.g. text-selecting through to whitespace, or
      // dragging the cursor a bit while typing) that ends outside the
      // modal would close it — really annoying.
      onMouseDown={(e) => {
        backdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropMouseDownRef.current) {
          onClose();
        }
        backdropMouseDownRef.current = false;
      }}
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
          {/* Kind switcher — three-way pill toggle. */}
          <Field label="Тип операции">
            <div className="inline-flex bg-panel2 border border-border rounded-lg p-0.5 w-full">
              <KindButton
                active={kind === "expense"}
                onClick={() => setKind("expense")}
                icon={TrendingDown}
                label="Расход"
                tone="expense"
              />
              <KindButton
                active={kind === "income"}
                onClick={() => setKind("income")}
                icon={TrendingUp}
                label="Доход"
                tone="income"
              />
              <KindButton
                active={kind === "transfer"}
                onClick={() => setKind("transfer")}
                icon={ArrowLeftRight}
                label="Перевод"
                tone="warn"
              />
            </div>
          </Field>
          <Field label="Дата">
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
                maxHeight={DROPDOWN_MAX}
                onChange={(next) => {
                  setCategory(next);
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
                maxHeight={DROPDOWN_MAX}
              />
            </Field>
          </div>
          {/* Payee — hidden for transfers (counterparty is the income
              account, surfaced below in its own field). */}
          {kind !== "transfer" && (
            <Field label="Получатель">
              <Combobox
                value={payee}
                options={payeeOptions}
                onChange={setPayee}
                placeholder="Введите или выберите из списка"
                maxHeight={DROPDOWN_MAX}
              />
            </Field>
          )}
          <Field label="Комментарий">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              className="input text-sm w-full resize-y"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
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
          </div>
          {/* Account(s): one field for income/expense, two for transfer. */}
          {kind === "transfer" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Со счёта">
                <Combobox
                  value={outAcc}
                  options={accountOptions}
                  onChange={setOutAcc}
                  placeholder="Источник"
                  maxHeight={DROPDOWN_MAX}
                />
              </Field>
              <Field label="На счёт">
                <Combobox
                  value={inAcc}
                  options={accountOptions}
                  onChange={setInAcc}
                  placeholder="Получатель"
                  maxHeight={DROPDOWN_MAX}
                />
              </Field>
            </div>
          ) : (
            <Field label="Счёт">
              <Combobox
                value={account}
                options={accountOptions}
                onChange={setAccount}
                placeholder="Введите или выберите из списка"
                maxHeight={DROPDOWN_MAX}
              />
            </Field>
          )}
          <p className="text-[11px] text-muted">
            Правки сохраняются локально как overlay поверх данных. Следующая
            синхронизация с API их не затрёт.
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

function KindButton({
  active,
  onClick,
  icon: Icon,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone: "income" | "expense" | "warn";
}) {
  const activeBg =
    tone === "income"
      ? "bg-income text-white"
      : tone === "expense"
        ? "bg-expense text-white"
        : "bg-warn text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active ? activeBg : "text-muted hover:text-text"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
