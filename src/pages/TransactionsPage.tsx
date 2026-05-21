import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Download,
  Pencil,
  TrendingUp,
  TrendingDown,
  Wallet,
  Hash,
  ListFilter,
  ListChecks,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useEditsStore } from "../store/useEditsStore";
import { useFiltersStore, applyFilters } from "../store/useFiltersStore";
import { useReportPeriodStore } from "../store/useReportPeriodStore";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { CategoryDot } from "../components/CategoryDot";
import { EmptyState } from "../components/EmptyState";
import { GlobalFilters } from "../components/GlobalFilters";
import { PageHeader } from "../components/PageHeader";
import { Stat } from "../components/Stat";
import { formatMoney, formatNum } from "../lib/format";
import type { Transaction } from "../types";

type SortMode = "date-desc" | "date-asc" | "amount-desc" | "amount-asc";

/**
 * Column templates are defined as CSS grid-template-columns and applied to
 * every row + the header so widths can never drift between days/rows.
 * Комментарий — самый широкий столбец (2.5fr), все остальные tracks
 * фиксированы либо имеют minmax(0, Xfr), что разрешает `truncate` усекать
 * содержимое многоточием вместо растяжения колонки.
 *
 * Track order:
 *   FULL: date · category · payee · comment · account · amount · edit
 *   NODATE: (используется внутри group-by-day) то же самое без date
 */
const GRID_COLS_FULL =
  "84px minmax(0, 1.3fr) minmax(0, 1.3fr) minmax(0, 2.6fr) minmax(0, 1fr) 140px 36px";
const GRID_COLS_NODATE =
  "minmax(0, 1.3fr) minmax(0, 1.3fr) minmax(0, 2.6fr) minmax(0, 1fr) 140px 36px";

const PAGE_SIZE = 100;

/**
 * "Операции" — сквозная лента всех операций, попадающих под глобальные
 * фильтры. По умолчанию отсортированы по дате (новые сверху) и
 * сгруппированы по дням ("Сегодня", "Вчера", полная дата).
 */
export function TransactionsPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const filters = useFiltersStore();
  const monthStartDay = useReportPeriodStore((s) => s.monthStartDay);

  const edits = useEditsStore((s) => s.edits);
  const editsLoaded = useEditsStore((s) => s.loaded);
  const hydrateEdits = useEditsStore((s) => s.hydrate);
  useEffect(() => {
    if (!editsLoaded) hydrateEdits();
  }, [editsLoaded, hydrateEdits]);

  const [pageSearch, setPageSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("date-desc");
  const [editing, setEditing] = useState<Transaction | null>(null);

  const filtered = useMemo(
    () => applyFilters(transactions, filters, monthStartDay),
    [transactions, filters, monthStartDay]
  );

  const searched = useMemo(() => {
    const q = pageSearch.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((t) =>
      `${t.payee} ${t.comment} ${t.categoryFull} ${t.account}`.toLowerCase().includes(q)
    );
  }, [filtered, pageSearch]);

  const sorted = useMemo(() => {
    const arr = [...searched];
    arr.sort((a, b) => {
      switch (sortMode) {
        case "date-desc":
          return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
        case "date-asc":
          return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
        case "amount-desc":
          return b.amountBase - a.amountBase;
        case "amount-asc":
          return a.amountBase - b.amountBase;
      }
    });
    return arr;
  }, [searched, sortMode]);

  const totals = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const t of searched) {
      if (t.kind === "income") inc += t.amountBase;
      else if (t.kind === "expense") exp += t.amountBase;
    }
    return { inc, exp, net: inc - exp, count: searched.length };
  }, [searched]);

  // Lazy reveal: render PAGE_SIZE rows initially; an IntersectionObserver at
  // the bottom of the list increases this by another PAGE_SIZE whenever the
  // sentinel scrolls into view. Drops to defaults whenever the underlying
  // sorted array changes (search/filter/sort) — done during render via the
  // "adjusting state based on prior props" pattern (avoids a setState-in-effect).
  const [prevSorted, setPrevSorted] = useState(sorted);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  if (sorted !== prevSorted) {
    setPrevSorted(sorted);
    setVisibleCount(PAGE_SIZE);
  }

  const visible = useMemo(() => sorted.slice(0, visibleCount), [sorted, visibleCount]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (visibleCount >= sorted.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisibleCount((n) => Math.min(n + PAGE_SIZE, sorted.length));
          }
        }
      },
      { rootMargin: "400px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, sorted.length]);

  // Group by day only when sorted by date. Apply lazy slicing FIRST so groups
  // appear/grow incrementally as the user scrolls.
  const groupedByDay = useMemo(() => {
    if (sortMode !== "date-desc" && sortMode !== "date-asc") return null;
    const groups = new Map<string, Transaction[]>();
    for (const t of visible) {
      const ymd = t.date.slice(0, 10);
      let bucket = groups.get(ymd);
      if (!bucket) {
        bucket = [];
        groups.set(ymd, bucket);
      }
      bucket.push(t);
    }
    return Array.from(groups.entries());
  }, [visible, sortMode]);

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
    a.download = "dzenanalytics_операции.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (transactions.length === 0) return <EmptyState />;

  const showingTail = visibleCount < sorted.length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ListChecks}
        title="Операции"
        hint="Сквозная лента операций. Двойной клик — редактирование строки."
      />
      <GlobalFilters />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat
          label="Доходы"
          value={formatMoney(totals.inc, base, { decimals: 0 })}
          tone="income"
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <Stat
          label="Расходы"
          value={formatMoney(totals.exp, base, { decimals: 0 })}
          tone="expense"
          icon={<TrendingDown className="w-4 h-4" />}
        />
        <Stat
          label="Чистый"
          value={formatMoney(totals.net, base, { decimals: 0, signed: true })}
          tone={totals.net >= 0 ? "income" : "expense"}
          icon={<Wallet className="w-4 h-4" />}
        />
        <Stat
          label="Операций"
          value={formatNum(totals.count)}
          icon={<Hash className="w-4 h-4" />}
          hint={pageSearch ? `из ${filtered.length} в фильтре` : "под фильтрами"}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={pageSearch}
              onChange={(e) => setPageSearch(e.target.value)}
              placeholder="Поиск по получателю/комментарию/категории/счёту"
              className="input pl-9 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <ListFilter className="w-3.5 h-3.5 text-muted" />
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="input text-xs !py-1.5 !px-2 w-auto"
            >
              <option value="date-desc">Дата ↓ (новые)</option>
              <option value="date-asc">Дата ↑ (старые)</option>
              <option value="amount-desc">Сумма ↓ (крупные)</option>
              <option value="amount-asc">Сумма ↑ (мелкие)</option>
            </select>
          </div>
          <button onClick={exportCsv} className="btn-ghost text-xs whitespace-nowrap">
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
        </div>

        {sorted.length === 0 ? (
          <div className="text-center text-muted text-sm py-16">
            По текущим фильтрам ничего не найдено
          </div>
        ) : groupedByDay ? (
          <div>
            <HeaderRow grouped />
            {groupedByDay.map(([ymd, txs]) => (
              <DayGroup
                key={ymd}
                ymd={ymd}
                txs={txs}
                base={base}
                edits={edits}
                onEdit={setEditing}
              />
            ))}
          </div>
        ) : (
          <div>
            <HeaderRow grouped={false} />
            {visible.map((t) => (
              <Row
                key={t.id}
                tx={t}
                edited={!!edits[t.id]}
                onEdit={() => setEditing(t)}
              />
            ))}
          </div>
        )}

        {/* Lazy-load sentinel + footer */}
        {sorted.length > 0 && (
          <div
            ref={sentinelRef}
            className="px-4 py-3 text-center text-xs text-muted border-t border-border"
          >
            {showingTail
              ? `Показано ${visibleCount} из ${sorted.length} — прокрутите дальше, чтобы загрузить ещё`
              : `Всего ${sorted.length} операций`}
          </div>
        )}
      </div>

      {editing && (
        <EditTransactionModal tx={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** Колоночные заголовки. Сетка та же, что и у строк. */
function HeaderRow({ grouped }: { grouped: boolean }) {
  const template = grouped ? GRID_COLS_NODATE : GRID_COLS_FULL;
  return (
    <div
      className="grid items-center gap-3 px-3 py-2 border-b border-border bg-panel text-xs uppercase tracking-wider text-muted font-medium sticky top-0 z-20"
      style={{ gridTemplateColumns: template }}
    >
      {!grouped && <div>Дата</div>}
      <div>Категория</div>
      <div>Получатель</div>
      <div>Комментарий</div>
      <div>Счёт</div>
      <div className="text-right">Сумма</div>
      <div />
    </div>
  );
}

function DayGroup({
  ymd,
  txs,
  base,
  edits,
  onEdit,
}: {
  ymd: string;
  txs: Transaction[];
  base: string;
  edits: Record<string, unknown>;
  onEdit: (t: Transaction) => void;
}) {
  const { label, weekday } = useMemo(() => formatDayHeader(ymd), [ymd]);
  const totals = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const t of txs) {
      if (t.kind === "income") inc += t.amountBase;
      else if (t.kind === "expense") exp += t.amountBase;
    }
    return { inc, exp, net: inc - exp };
  }, [txs]);

  return (
    <div>
      <div className="px-4 py-2 border-b border-t border-border bg-panel2/60 flex items-center gap-3 text-sm">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-semibold truncate">{label}</span>
          {weekday && <span className="text-xs text-muted">{weekday}</span>}
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs tabular-nums">
          <span className="text-muted whitespace-nowrap">{txs.length} оп.</span>
          {totals.inc > 0 && (
            <span className="text-income whitespace-nowrap">
              +{formatMoney(totals.inc, base, { compact: true })}
            </span>
          )}
          {totals.exp > 0 && (
            <span className="text-expense whitespace-nowrap">
              −{formatMoney(totals.exp, base, { compact: true })}
            </span>
          )}
          <span
            className={`font-medium whitespace-nowrap ${totals.net >= 0 ? "text-income" : "text-expense"}`}
            title="Чистый поток за день"
          >
            {formatMoney(totals.net, base, { compact: true, signed: true })}
          </span>
        </div>
      </div>
      {txs.map((t) => (
        <Row
          key={t.id}
          tx={t}
          edited={!!edits[t.id]}
          onEdit={() => onEdit(t)}
          hideDate
        />
      ))}
    </div>
  );
}

function Row({
  tx,
  edited,
  onEdit,
  hideDate = false,
}: {
  tx: Transaction;
  edited: boolean;
  onEdit: () => void;
  hideDate?: boolean;
}) {
  const template = hideDate ? GRID_COLS_NODATE : GRID_COLS_FULL;
  const amountColor =
    tx.kind === "income"
      ? "text-income"
      : tx.kind === "expense"
        ? "text-expense"
        : "text-warn";
  const amountSign = tx.kind === "income" ? "+" : tx.kind === "expense" ? "−" : "↔";

  return (
    <div
      onDoubleClick={onEdit}
      className="grid items-center gap-3 px-3 py-2 border-b border-border/40 hover:bg-panel2/40 cursor-pointer group text-sm"
      style={{ gridTemplateColumns: template }}
      title="Двойной клик — редактировать"
    >
      {!hideDate && (
        <div className="text-muted text-xs tabular-nums whitespace-nowrap">
          {tx.date.slice(8, 10)}.{tx.date.slice(5, 7)}.{tx.date.slice(2, 4)}
        </div>
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0" title={tx.categoryFull}>
          <CategoryDot category={tx.category} size="w-5 h-5" />
          <span className="truncate">{tx.category}</span>
          {edited && (
            <Pencil
              className="w-3 h-3 text-accent2 shrink-0"
              aria-label="Отредактировано"
            />
          )}
        </div>
        {tx.subcategory && (
          <div className="text-xs text-muted truncate pl-7" title={tx.subcategory}>
            {tx.subcategory}
          </div>
        )}
      </div>
      <div className="truncate" title={tx.payee || ""}>
        {tx.payee || <span className="text-muted">—</span>}
      </div>
      <div className="text-xs text-muted truncate" title={tx.comment || ""}>
        {tx.comment || ""}
      </div>
      <div className="truncate text-muted text-xs" title={tx.account}>
        {tx.account}
      </div>
      <div
        className={`text-right tabular-nums font-medium whitespace-nowrap ${amountColor}`}
      >
        {amountSign}
        {formatMoney(tx.amount, tx.currency)}
      </div>
      <div className="text-right">
        <button
          onClick={onEdit}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted hover:text-text"
          title="Редактировать"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function formatDayHeader(ymd: string): { label: string; weekday: string } {
  const d = new Date(ymd);
  if (Number.isNaN(d.getTime())) return { label: ymd, weekday: "" };

  const today = new Date();
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yYmd = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

  const day = d.getDate();
  const month = MONTHS_GEN[d.getMonth()];
  const year = d.getFullYear();
  const weekday = WEEKDAYS[d.getDay()];
  const dateLabel = `${day} ${month}${year === today.getFullYear() ? "" : ` ${year}`}`;

  if (ymd === todayYmd) return { label: `Сегодня, ${dateLabel}`, weekday };
  if (ymd === yYmd) return { label: `Вчера, ${dateLabel}`, weekday };
  return { label: dateLabel, weekday };
}
