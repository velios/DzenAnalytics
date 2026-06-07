import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Save, X, TrendingUp, TrendingDown, ArrowLeftRight, Undo2, Trash2 } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore } from "../store/useEditsStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { getBrandTitlesFromCache, useZenmoneyStore } from "../store/useZenmoneyStore";
import { confirm } from "../store/useConfirmStore";
import { Combobox } from "./Combobox";
import { DateField } from "./DateField";
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
  const deleteTransaction = useDataStore((s) => s.deleteTransaction);

  async function handleDelete() {
    const pushMode = useZenmoneyStore.getState().pushMode;
    const ok = await confirm({
      title: "Удалить операцию?",
      message:
        pushMode !== "off"
          ? "Операция скроется из всех расчётов и списков. Так как включён Push, при следующей отправке она будет удалена и в облаке Дзен-мани. Вернуть можно на странице «Удалённые» — в т.ч. в облако."
          : "Операция скроется из всех расчётов и списков. Вернуть можно на странице «Удалённые». В облаке Дзен-мани она не тронется.",
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (!ok) return;
    await deleteTransaction(tx.id);
    onClose();
  }

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

  // "Получатель" suggestions, served as two distinct groups so the
  // user can tell at a glance which bucket a suggestion comes from:
  //   1) "Получатели Дзен-мани" — everything that's been through
  //      Zenmoney's merchant dictionary. Includes both global-catalog
  //      brands (Wildberries, Магнит) AND user-created entries
  //      ("Сосед Сёма"). The API gives no flag to distinguish the two,
  //      so we don't try. The label says "получатели", not "бренды",
  //      to avoid implying the list is the global brand catalog only.
  //   2) "Из выписок банка" — raw payee strings that *don't* have a
  //      merchant assigned. The bank's printout as-is, never touched
  //      by Zenmoney's normalization.
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
  const payeeGroups = useMemo(() => {
    const brandSet = new Set<string>();
    if (cachedBrands) for (const b of cachedBrands) brandSet.add(b);
    for (const t of allTransactions) {
      const b = t.brand?.trim();
      if (b) brandSet.add(b);
    }
    const payeeSet = new Set<string>();
    for (const t of allTransactions) {
      const p = t.payee?.trim();
      if (p && !brandSet.has(p)) payeeSet.add(p);
    }
    const cmp = (a: string, b: string) => a.localeCompare(b, "ru");
    const groups = [];
    if (brandSet.size > 0) {
      groups.push({
        label: "Получатели Дзен-мани",
        items: Array.from(brandSet).sort(cmp),
      });
    }
    if (payeeSet.size > 0) {
      groups.push({
        label: "Из выписок банка",
        items: Array.from(payeeSet).sort(cmp),
      });
    }
    return groups;
  }, [cachedBrands, allTransactions]);
  // Flat fallback — used by Combobox only when `groups` is empty
  // (rare: no cache and no transactions yet).
  const payeeOptions = useMemo(
    () => payeeGroups.flatMap((g) => g.items),
    [payeeGroups]
  );

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

      // Build a MINIMAL patch — only fields whose new value actually
      // differs from the original transaction. This matters for the
      // push pipeline: `buildPushItems` checks `edit.<field> !== undefined`
      // to decide whether the user touched a field, so stashing every
      // value here (even unchanged ones) would make a payee-only edit
      // look like a type-or-account change and get rejected by Phase 1
      // validation.
      const patch: Record<string, unknown> = {};

      // Helpers: trim both sides before comparing so a whitespace-only
      // delta still registers as "no change", but a real edit always
      // lands in the patch. Treating null/undefined as "" makes the
      // comparison total.
      const norm = (v: string | null | undefined) => (v ?? "").trim();
      const changed = (next: string, before: string | null | undefined) =>
        norm(next) !== norm(before);

      if (safeDate !== tx.date) patch.date = safeDate;

      const nextCategory = category.trim() || tx.category;
      if (changed(nextCategory, tx.category)) patch.category = nextCategory;

      const nextSubRaw = subcategory.trim();
      const nextSub = nextSubRaw || null;
      if (changed(nextSubRaw, tx.subcategory ?? "")) patch.subcategory = nextSub;

      // Brand — single "Получатель" UI field maps to the brand field
      // on the data model. Empty → null so display falls back to raw
      // payee. The raw `payee` (bank-statement text) is preserved
      // untouched as historical source-of-truth and never written here.
      const nextBrand = payee.trim() || null;
      if (norm(payee) !== norm(tx.brand ?? "")) patch.brand = nextBrand;

      const nextComment = comment.trim();
      if (changed(nextComment, tx.comment)) patch.comment = nextComment;

      if (safeAmount !== tx.amount) patch.amount = safeAmount;

      const nextCurrency = currency.trim() || tx.currency;
      if (changed(nextCurrency, tx.currency)) patch.currency = nextCurrency;

      if (kind !== tx.kind) patch.kind = kind;

      if (kind === "transfer") {
        // For transfers we need both legs in sync. Whether or not the
        // user actually changed any account, write all three so the
        // pipeline never sees half-stale data. The push transformer
        // will compare against the original to decide if it's a real
        // change worth refusing.
        const src = outAcc.trim() || tx.outcomeAccount || tx.account;
        const dst = inAcc.trim() || tx.incomeAccount || "";
        if (
          changed(src, tx.outcomeAccount) ||
          changed(dst, tx.incomeAccount) ||
          changed(src, tx.account)
        ) {
          patch.outcomeAccount = src;
          patch.incomeAccount = dst;
          patch.account = src; // mapper convention: transfer rows live under source
        }
      } else {
        const nextAccount = account.trim() || tx.account;
        if (changed(nextAccount, tx.account)) {
          patch.account = nextAccount;
          // Refund is an income-side flow too — the merchant returned
          // money TO the account — so the same convention as `income`
          // applies for which leg gets the account id.
          if (kind === "income" || kind === "refund") {
            patch.incomeAccount = nextAccount;
            patch.outcomeAccount = "";
          } else {
            patch.outcomeAccount = nextAccount;
            patch.incomeAccount = "";
          }
        }
      }

      // Nothing changed — bail without writing an empty overlay entry.
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }

      await setEdit(tx.id, patch);
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

  // Portal to <body> so the overlay isn't a child of the page tree.
  // Rendered inline it inherited a `margin-top: 24px` from the parent's
  // `space-y-6` utility (it's a sibling row), which on a `fixed top:0`
  // element pushed the scrim down 24px — leaving an uncovered strip at
  // the top. A body-level portal also matches the standard modal pattern
  // (immune to ancestor transforms / containing blocks).
  return createPortal(
    <div
      // Plain dim scrim — NO backdrop-filter. A full-viewport
      // `backdrop-blur` over the chart-heavy page makes Chromium snapshot
      // the page to blur it, which intermittently flashes the root
      // (white) background for a frame on open. A solid dim never does.
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
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
            <DateField
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input text-sm w-full"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {/* Category / Subcategory — picker-only. Free-form text
                is blocked (`allowCustom={false}`) so we can never end
                up with a value that doesn't exist in Zenmoney's tag
                dictionary — that'd just get rejected by the push
                transformer with a "tag not found" error anyway. */}
            <Field label="Категория">
              <Combobox
                value={category}
                options={categoryOptions}
                allowCustom={false}
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
                allowCustom={false}
                clearable
                onChange={setSubcategory}
                placeholder="—"
                maxHeight={DROPDOWN_MAX}
              />
            </Field>
          </div>
          {/* Account(s): one field for income/expense, two for transfer.
              Placed right under category — it's the second-most
              identifying attribute of a transaction after the category. */}
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
          {/* Single "Получатель" field — autocompletes from the
              Zenmoney merchant dictionary plus historical raw-payee
              strings. Hidden for transfers (counterparty there is the
              income account, surfaced above in its own field). */}
          {kind !== "transfer" && (
            <Field label="Получатель">
              <Combobox
                value={payee}
                options={payeeOptions}
                groups={payeeGroups}
                onChange={setPayee}
                placeholder="Введите или выберите из списка"
                maxHeight={DROPDOWN_MAX}
              />
              {/* Tells the user how the current value will be pushed.
                  Matching the dictionary by case-insensitive equality
                  mirrors the lookup in zenmoneyPush.ts so the hint
                  doesn't lie about what actually happens. */}
              <PayeeKindHint value={payee} cachedBrands={cachedBrands} />
              {tx.payeeRaw && tx.payeeRaw !== payee && (
                // Honest "as printed by the bank" hint — uses the
                // immutable `payeeRaw` (originalPayee from the API),
                // not the possibly-edited `payee`. Helps the user
                // figure out where a weird counterparty name came
                // from. Hidden when raw equals current value.
                <div
                  className="text-[10px] text-muted/80 mt-1 pl-0 truncate"
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
              rows={1}
              // Single row by default; user can drag taller. min-h
              // matches one line + the input's vertical padding so it
              // can never shrink below a single readable row.
              className="input text-sm w-full resize-y min-h-[2.5rem]"
            />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={handleDelete}
            disabled={saving}
            className="btn-danger text-sm"
            title="Удалить операцию"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Удалить
          </button>
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
    </div>,
    document.body
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

/**
 * Tiny indicator below the "Получатель" combobox. Tells the user
 * whether the currently-entered value will be pushed as a known
 * brand (merchant dictionary entry) or as free-text payee.
 *
 * Empty / whitespace-only input → render nothing (no noise on a
 * blank field). The dictionary lookup is case-insensitive to match
 * the equivalent lookup in `zenmoneyPush.ts`.
 */
function PayeeKindHint({
  value,
  cachedBrands,
}: {
  value: string;
  cachedBrands: string[] | null;
}) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // While the merchant dictionary is still being hydrated from cache
  // we don't know yet — stay silent rather than mislead.
  if (cachedBrands === null) return null;
  const lower = trimmed.toLowerCase();
  const matches = cachedBrands.some((b) => b.toLowerCase() === lower);
  if (matches) {
    return (
      <div className="text-[10px] text-income/90 mt-1 pl-0">
        Бренд из списка Дзен-мани ✓
      </div>
    );
  }
  return (
    <div className="text-[10px] text-muted mt-1 pl-0">
      Получатель не из списка Брендов ✗
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
