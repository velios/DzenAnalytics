import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Layers, X } from "lucide-react";
import { Combobox } from "./Combobox";
import type { Transaction } from "../types";
import type { TransactionEdit } from "../store/useEditsStore";

/**
 * Bulk-edit modal. Lets the user change Категория (+подкатегория),
 * Получатель and/or Комментарий for many selected transactions at once.
 *
 * Each field has an enable checkbox: only enabled fields go into the
 * patch, so the user can change one, two, or all three. An enabled but
 * empty Комментарий clears comments (valid); category/payee require a
 * value to be applied.
 *
 * The patch mirrors the single-row modal: Получатель maps to `brand`
 * (Zenmoney's curated counterparty), category/subcategory feed the
 * pipeline which derives categoryFull. Portaled to <body> so it isn't
 * affected by ancestor layout (e.g. `space-y` margins).
 */
interface Props {
  count: number;
  allTransactions: Transaction[];
  onApply: (patch: TransactionEdit) => void | Promise<void>;
  onClose: () => void;
}

export function BulkEditModal({ count, allTransactions, onApply, onClose }: Props) {
  const [enableCategory, setEnableCategory] = useState(false);
  const [enablePayee, setEnablePayee] = useState(false);
  const [enableComment, setEnableComment] = useState(false);

  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [payee, setPayee] = useState("");
  const [comment, setComment] = useState("");

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Option lists from the current dataset.
  const { categoryOptions, subcatByCategory, payeeOptions } = useMemo(() => {
    const cats = new Set<string>();
    const subByCat = new Map<string, Set<string>>();
    const payees = new Set<string>();
    for (const t of allTransactions) {
      if (t.category) cats.add(t.category);
      if (t.category && t.subcategory) {
        let bucket = subByCat.get(t.category);
        if (!bucket) {
          bucket = new Set<string>();
          subByCat.set(t.category, bucket);
        }
        bucket.add(t.subcategory);
      }
      const p = (t.brand || t.payee || "").trim();
      if (p) payees.add(p);
    }
    const cmp = (a: string, b: string) => a.localeCompare(b, "ru");
    return {
      categoryOptions: Array.from(cats).sort(cmp),
      subcatByCategory: subByCat,
      payeeOptions: Array.from(payees).sort(cmp),
    };
  }, [allTransactions]);

  const canApply =
    (enableCategory && category.trim() !== "") ||
    (enablePayee && payee.trim() !== "") ||
    enableComment;

  async function apply() {
    const patch: TransactionEdit = {};
    if (enableCategory && category.trim()) {
      patch.category = category.trim();
      patch.subcategory = subcategory.trim() || null;
    }
    if (enablePayee && payee.trim()) {
      patch.brand = payee.trim();
    }
    if (enableComment) {
      // Enabled-but-empty intentionally clears the comment.
      patch.comment = comment;
    }
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    try {
      await onApply(patch);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-panel shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2 font-semibold">
            <Layers className="w-4 h-4 text-accent" />
            Массовое изменение
            <span className="text-muted font-normal text-sm">
              · выбрано {count}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-text"
            title="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-muted">
            Отметьте поля, которые нужно изменить. Неотмеченные останутся как
            есть. Изменения применятся ко всем выбранным операциям.
          </p>

          {/* Category */}
          <FieldToggle
            label="Категория"
            enabled={enableCategory}
            onToggle={setEnableCategory}
          >
            <div className="grid grid-cols-2 gap-2">
              <Combobox
                value={category}
                options={categoryOptions}
                allowCustom={false}
                onChange={(next) => {
                  setCategory(next);
                  if (
                    subcategory &&
                    !subcatByCategory.get(next)?.has(subcategory)
                  ) {
                    setSubcategory("");
                  }
                }}
                placeholder="Категория"
                maxHeight="200px"
              />
              <Combobox
                value={subcategory}
                options={Array.from(subcatByCategory.get(category) || []).sort(
                  (a, b) => a.localeCompare(b, "ru")
                )}
                allowCustom={false}
                clearable
                onChange={setSubcategory}
                placeholder="Подкатегория (необяз.)"
                maxHeight="200px"
              />
            </div>
          </FieldToggle>

          {/* Payee */}
          <FieldToggle
            label="Получатель"
            enabled={enablePayee}
            onToggle={setEnablePayee}
          >
            <Combobox
              value={payee}
              options={payeeOptions}
              onChange={setPayee}
              placeholder="Новый получатель для всех"
              maxHeight="200px"
            />
          </FieldToggle>

          {/* Comment */}
          <FieldToggle
            label="Комментарий"
            enabled={enableComment}
            onToggle={setEnableComment}
          >
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="Новый комментарий (пусто — очистить)"
              className="input text-sm w-full resize-y min-h-[2.5rem]"
            />
          </FieldToggle>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-panel2/40 rounded-b-xl">
          <button onClick={onClose} className="btn-ghost text-sm">
            Отмена
          </button>
          <button
            onClick={apply}
            disabled={!canApply || saving}
            className="btn-primary text-sm"
          >
            Применить к выбранным ({count})
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** A labelled enable-checkbox that reveals its control when checked. */
function FieldToggle({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        enabled ? "border-accent/40 bg-accent/[0.03]" : "border-border"
      }`}
    >
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="accent-accent w-4 h-4"
        />
        <span className="text-sm font-medium">{label}</span>
      </label>
      {enabled && <div className="mt-3">{children}</div>}
    </div>
  );
}
