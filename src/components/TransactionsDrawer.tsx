import { useEffect, useMemo, useState } from "react";
import {
  X,
  Search,
  ArrowUpDown,
  Download,
  Sparkles,
  Tag,
  User,
  Pencil,
} from "lucide-react";
import { useDrillStore } from "../store/useDrillStore";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore } from "../store/useEditsStore";
import { CategoryDot } from "./CategoryDot";
import { EditTransactionModal } from "./EditTransactionModal";
import { formatMoney, formatDate } from "../lib/format";
import type { Transaction } from "../types";

type SortKey = "date" | "amount" | "category" | "payee";
type SortDir = "asc" | "desc";

export function TransactionsDrawer() {
  const { open, title, subtitle, transactions, close, show } = useDrillStore();
  const base = useDataStore((s) => s.rates.base);
  const allTransactions = useDataStore((s) => s.transactions);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [editing, setEditing] = useState<Transaction | null>(null);
  const edits = useEditsStore((s) => s.edits);
  const editsLoaded = useEditsStore((s) => s.loaded);
  const hydrateEdits = useEditsStore((s) => s.hydrate);
  useEffect(() => {
    if (!editsLoaded) hydrateEdits();
  }, [editsLoaded, hydrateEdits]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  // Reset search every time the drawer re-opens — implemented via the
  // "adjust state on prior props" pattern (no setState-in-effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSearch("");
  }

  // Drill store keeps a snapshot of transactions taken at the moment the drawer
  // was opened. After an inline edit the canonical `useDataStore.transactions`
  // is the source of truth, so we re-derive a fresh list by id-lookup.
  const liveTransactions = useMemo(() => {
    const byId = new Map(allTransactions.map((t) => [t.id, t]));
    return transactions.map((t) => byId.get(t.id) || t);
  }, [transactions, allTransactions]);

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? liveTransactions.filter((t) =>
          `${t.payee} ${t.comment} ${t.categoryFull} ${t.account}`.toLowerCase().includes(q)
        )
      : liveTransactions;
    const cmp = (a: Transaction, b: Transaction) => {
      let r = 0;
      if (sortKey === "date") r = a.date.localeCompare(b.date);
      else if (sortKey === "amount") r = a.amountBase - b.amountBase;
      else if (sortKey === "category") r = a.categoryFull.localeCompare(b.categoryFull, "ru");
      else if (sortKey === "payee") r = (a.payee || "").localeCompare(b.payee || "", "ru");
      return sortDir === "asc" ? r : -r;
    };
    return [...filtered].sort(cmp);
  }, [liveTransactions, search, sortKey, sortDir]);

  const totals = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const t of sorted) {
      if (t.kind === "income") inc += t.amountBase;
      else if (t.kind === "expense") exp += t.amountBase;
    }
    return { inc, exp, net: inc - exp };
  }, [sorted]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "date" || key === "amount" ? "desc" : "asc");
    }
  }

  function exportCsv() {
    const header = ["Дата", "Тип", "Категория", "Получатель", "Комментарий", "Счёт", "Сумма", "Валюта"];
    const lines = [
      header.join(";"),
      ...sorted.map((t) =>
        [
          t.date,
          t.kind === "income" ? "доход" : t.kind === "expense" ? "расход" : "перевод",
          `"${t.categoryFull.replace(/"/g, '""')}"`,
          `"${(t.payee || "").replace(/"/g, '""')}"`,
          `"${(t.comment || "").replace(/"/g, '""')}"`,
          `"${t.account.replace(/"/g, '""')}"`,
          t.amount,
          t.currency,
        ].join(";")
      ),
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dzenanalytics_${title.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!open) return null;

  return (
    <>
    <aside className="fixed inset-0 bg-bg z-50 flex flex-col animate-fade">
      <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-4 sticky top-0 bg-panel/95 backdrop-blur z-10">
        <div className="min-w-0">
          <div className="text-sm text-muted">{subtitle || "Операции"}</div>
          <div className="text-xl font-semibold truncate" title={title}>
            {title}
          </div>
        </div>
        <button
          onClick={close}
          className="btn-ghost text-sm shrink-0"
          aria-label="Закрыть (Esc)"
          title="Закрыть (Esc)"
        >
          <X className="w-4 h-4" />
          <span>Закрыть</span>
          <kbd className="ml-1 px-1.5 py-0.5 text-[10px] rounded bg-panel2 border border-border font-mono">
            Esc
          </kbd>
        </button>
      </div>

        {transactions.length === 1 && (
          <div className="px-5 py-2 border-b border-border flex items-center gap-2 flex-wrap text-xs bg-accent/5">
            <span className="flex items-center gap-1 text-muted">
              <Sparkles className="w-3 h-3 text-accent" />
              Похожие:
            </span>
            <button
              onClick={() => {
                const t = transactions[0];
                const sim = allTransactions.filter(
                  (x) => x.kind === t.kind && x.categoryFull === t.categoryFull
                );
                show(`Категория: ${t.categoryFull}`, sim, "Похожие операции");
              }}
              className="btn-ghost !py-1 !px-2 text-xs"
            >
              <Tag className="w-3 h-3" />
              По категории «{transactions[0].categoryFull}»
            </button>
            {transactions[0].payee && (
              <button
                onClick={() => {
                  const t = transactions[0];
                  const sim = allTransactions.filter(
                    (x) => x.kind === t.kind && x.payee === t.payee
                  );
                  show(`Получатель: ${t.payee}`, sim, "Похожие операции");
                }}
                className="btn-ghost !py-1 !px-2 text-xs"
              >
                <User className="w-3 h-3" />
                По получателю «{transactions[0].payee}»
              </button>
            )}
          </div>
        )}

        <div className="px-5 py-3 border-b border-border grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="label">Доходы</div>
            <div className="text-income font-semibold tabular-nums">
              {formatMoney(totals.inc, base, { compact: true })}
            </div>
          </div>
          <div>
            <div className="label">Расходы</div>
            <div className="text-expense font-semibold tabular-nums">
              {formatMoney(totals.exp, base, { compact: true })}
            </div>
          </div>
          <div>
            <div className="label">Чистый</div>
            <div
              className={`font-semibold tabular-nums ${
                totals.net >= 0 ? "text-income" : "text-expense"
              }`}
            >
              {formatMoney(totals.net, base, { compact: true, signed: true })}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по получателю/комментарию/категории/счёту"
              className="input pl-9 text-sm"
            />
          </div>
          <button onClick={exportCsv} className="btn-ghost text-xs whitespace-nowrap">
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <div className="text-xs text-muted whitespace-nowrap">
            {sorted.length} из {transactions.length}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {sorted.length === 0 ? (
            <div className="text-center text-muted text-sm py-12">
              {transactions.length === 0
                ? "Нет операций"
                : "По запросу ничего не найдено"}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-panel z-10">
                <tr>
                  <SortHead label="Дата" k="date" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortHead label="Категория" k="category" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortHead label="Получатель" k="payee" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="table-th">Комментарий</th>
                  <th className="table-th">Счёт</th>
                  <SortHead label="Сумма" k="amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <th className="table-th w-8"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => {
                  const isEdited = !!edits[t.id];
                  return (
                  <tr
                    key={t.id}
                    onDoubleClick={() => setEditing(t)}
                    className="hover:bg-panel2/40 align-top group cursor-pointer"
                    title="Двойной клик — редактировать"
                  >
                    <td className="table-td whitespace-nowrap text-muted">
                      {formatDate(t.date, "short")}
                    </td>
                    <td className="table-td max-w-[180px]">
                      <div className="truncate flex items-center gap-2" title={t.categoryFull}>
                        <CategoryDot category={t.category} size="w-5 h-5" />
                        <span className="truncate">{t.category}</span>
                        {isEdited && (
                          <Pencil
                            className="w-3 h-3 text-accent2 shrink-0"
                            aria-label="Отредактировано"
                          />
                        )}
                      </div>
                      {t.subcategory && (
                        <div className="text-xs text-muted truncate" title={t.subcategory}>
                          {t.subcategory}
                        </div>
                      )}
                    </td>
                    <td className="table-td max-w-[180px] truncate" title={t.payee}>
                      {t.payee || <span className="text-muted">—</span>}
                    </td>
                    <td className="table-td max-w-[260px] text-xs text-muted">
                      <div className="line-clamp-2" title={t.comment}>
                        {t.comment || ""}
                      </div>
                    </td>
                    <td className="table-td max-w-[140px] truncate text-muted text-xs" title={t.account}>
                      {t.account}
                    </td>
                    <td
                      className={`table-td text-right tabular-nums font-medium whitespace-nowrap ${
                        t.kind === "income"
                          ? "text-income"
                          : t.kind === "expense"
                            ? "text-expense"
                            : "text-warn"
                      }`}
                    >
                      {t.kind === "income" ? "+" : t.kind === "expense" ? "−" : "↔"}
                      {formatMoney(t.amount, t.currency)}
                    </td>
                    <td className="table-td w-8 text-right">
                      <button
                        onClick={() => setEditing(t)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted hover:text-text"
                        title="Редактировать"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </aside>
      {editing && (
        <EditTransactionModal
          tx={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function SortHead({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <th className={`table-th ${align === "right" ? "text-right" : ""}`}>
      <button
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 hover:text-text transition-colors ${
          active ? "text-accent" : ""
        }`}
      >
        {label}
        <ArrowUpDown className={`w-3 h-3 ${active ? "" : "opacity-30"}`} />
        {active && <span className="text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
