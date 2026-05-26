import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, RotateCcw, Save, X, TrendingUp, TrendingDown, ArrowLeftRight, Undo2 } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore } from "../store/useEditsStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { getBrandTitlesFromCache } from "../store/useZenmoneyStore";
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

  // Combined "Получатель" suggestions — Zenmoney calls these
  // "merchants" / "Бренды" in their UI but in the API there's no
  // distinction between curated brands and user-created entries, so
  // we treat them as one flat list. Source priority:
  //   1) Full merchant dictionary from the Zenmoney cache (async).
  //   2) `brand` values seen in the user's transactions (fallback for
  //      CSV-only users + a safety net in case the cache lookup races).
  //   3) Historical `payee` values — what the bank ever printed.
  // Deduped, sorted alphabetically.
  const [cachedBrands, setCachedBrands] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getBrandTitlesFromCache().then((list) => {
      if (!cancelled) setCachedBrands(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const payeeOptions = useMemo(() => {
    const set = new Set<string>();
    if (cachedBrands) for (const b of cachedBrands) set.add(b);
    for (const t of allTransactions) {
      const b = t.brand?.trim();
      if (b) set.add(b);
      const p = t.payee?.trim();
      if (p) set.add(p);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [cachedBrands, allTransactions]);

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
  // Single "Получатель" field — saves into `brand`, which is the
  // displayed counterparty name. Falls back to `tx.payee` for
  // transactions that don't have a brand attached yet (CSV imports,
  // unbranded operations). The raw bank-statement text (`tx.payee`)
  // is left untouched in the data — it stays as the source of truth
  // for what the bank actually printed.
  const [payee, setPayee] = useState(tx.brand?.trim() || tx.payee || "");
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
      // The single "Получатель" UI field is the displayed counterparty
      // name — saved into `brand`. The raw `payee` (bank-statement
      // text) is preserved untouched as historical source-of-truth.
      // Empty input → brand = null → display falls back to raw payee.
      const payeeTrimmed = payee.trim();
      const patch: Record<string, unknown> = {
        date: safeDate,
        category: category.trim() || tx.category,
        subcategory: subcategory.trim() || null,
        brand: payeeTrimmed ? payeeTrimmed : null,
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
        // Refund is an income-side flow too — the merchant returned
        // money TO the account — so the same convention as `income`
        // applies for which leg gets the account id.
        if (kind === "income" || kind === "refund") {
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
          {/* Kind switcher — 4-way pill toggle. "Возврат" is a money-back
              flow on an expense category; it inflows the account but
              shrinks the category's spend rather than adding to income. */}
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
                active={kind === "refund"}
                onClick={() => setKind("refund")}
                icon={Undo2}
                label="Возврат"
                tone="accent2"
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
          {/* Single "Получатель" field — autocompletes from the
              Zenmoney merchant dictionary plus historical raw-payee
              strings. Hidden for transfers (counterparty there is the
              income account, surfaced below in its own field). */}
          {kind !== "transfer" && (
            <Field label="Получатель">
              <Combobox
                value={payee}
                options={payeeOptions}
                onChange={setPayee}
                placeholder="Введите или выберите из списка"
                maxHeight={DROPDOWN_MAX}
              />
              {tx.payeeRaw && tx.payeeRaw !== payee && (
                // Honest "as printed by the bank" hint — uses the
                // immutable `payeeRaw` (originalPayee from the API),
                // not the possibly-edited `payee`. Helps the user
                // figure out where a weird counterparty name came
                // from. Hidden when raw equals current value.
                <div
                  className="text-[10px] text-muted/80 mt-1 truncate"
                  title={tx.payeeRaw}
                >
                  В выписке: {tx.payeeRaw}
                </div>
              )}
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
  tone: "income" | "expense" | "warn" | "accent2";
}) {
  const activeBg =
    tone === "income"
      ? "bg-income text-white"
      : tone === "expense"
        ? "bg-expense text-white"
        : tone === "accent2"
          ? "bg-accent2 text-white"
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
