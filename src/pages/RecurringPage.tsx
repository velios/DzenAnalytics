import { useMemo, useState } from "react";
import { Repeat, Calendar, AlertCircle, TrendingUp, TrendingDown } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { detectRecurring, type RecurringCandidate } from "../lib/aggregations";
import { formatMoney, formatDate, formatNum } from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { SortableTable, type Column } from "../components/SortableTable";

// One pill per coarse cadence bucket, plus an "all" pseudo-option.
// Order matches the user's likely usage frequency on this page:
// most subscriptions are monthly, weekly is the next bucket, and
// quarterly ones are the rare-but-meaningful tail.
type CadenceFilter = "all" | "weekly" | "monthly" | "quarterly";
const CADENCE_LABEL: Record<Exclude<CadenceFilter, "all">, string> = {
  weekly: "Еженедельные",
  monthly: "Ежемесячные",
  quarterly: "Реже раза в месяц",
};

export function RecurringPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const showDrill = useDrillStore((s) => s.show);

  const allCandidates = useMemo(() => detectRecurring(transactions), [transactions]);
  const [cadenceFilter, setCadenceFilter] = useState<CadenceFilter>("all");
  const [onlyPriceUp, setOnlyPriceUp] = useState(false);
  // "Активные" = последний платёж не старше года. Прячет давно умершие
  // подписки (последний раз, скажем, в 2020-м), которые всё ещё подходят
  // под паттерн регулярного, но фактически больше не повторяются.
  const [onlyActive, setOnlyActive] = useState(false);
  const activeCutoff = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  }, []);

  const candidates = useMemo(() => {
    return allCandidates.filter((c) => {
      if (cadenceFilter !== "all" && c.cadence !== cadenceFilter) return false;
      if (onlyPriceUp && c.priceTrend.priceFlag !== "up") return false;
      if (onlyActive && c.lastDate < activeCutoff) return false;
      return true;
    });
  }, [allCandidates, cadenceFilter, onlyPriceUp, onlyActive, activeCutoff]);

  const activeCount = useMemo(
    () => allCandidates.filter((c) => c.lastDate >= activeCutoff).length,
    [allCandidates, activeCutoff]
  );

  const priceUpCount = allCandidates.filter(
    (c) => c.priceTrend.priceFlag === "up"
  ).length;

  if (transactions.length === 0) return <EmptyState />;

  const totalMonthly = candidates.reduce((s, c) => {
    if (c.avgIntervalDays > 0) return s + (c.avgAmount * 30) / c.avgIntervalDays;
    return s;
  }, 0);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = candidates.filter((c) => c.nextExpected >= today).sort((a, b) => a.nextExpected.localeCompare(b.nextExpected));

  function openCandidate(c: { txIds: string[]; payee: string }) {
    const txs = transactions.filter((t) => c.txIds.includes(t.id));
    showDrill(c.payee, txs, "Регулярные платежи");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Repeat className="w-6 h-6 text-accent" />
          Регулярные платежи
        </h1>
        <p className="text-muted text-sm mt-1">
          Автодетект подписок и регулярных трат: одинаковый получатель, ~стабильная сумма,
          интервал 5–95 дней, минимум 3 повтора. Глобальные фильтры тут не применяются —
          анализируется вся история.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card card-pad">
          <div className="label mb-1">Найдено</div>
          <div className="stat-num">{candidates.length}</div>
          <div className="text-xs text-muted mt-1">регулярных платежей</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">≈ в месяц</div>
          <div className="stat-num text-warn">
            {formatMoney(totalMonthly, base)}
          </div>
          <div className="text-xs text-muted mt-1">оценка нагрузки</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">≈ в год</div>
          <div className="stat-num text-warn">
            {formatMoney(totalMonthly * 12, base)}
          </div>
          <div className="text-xs text-muted mt-1">экстраполяция</div>
        </div>
        {/* "Подорожали" — surfaces subscriptions where the last charge
            jumped 10%+ above the historical average. Empty state when
            nothing changed gets a neutral colour; otherwise warn-coloured
            and clickable as a quick filter. */}
        <button
          type="button"
          onClick={() => priceUpCount > 0 && setOnlyPriceUp((v) => !v)}
          className={`card card-pad text-left transition-colors ${
            priceUpCount > 0 ? "hover:border-warn cursor-pointer" : "cursor-default"
          } ${onlyPriceUp ? "border-warn ring-1 ring-warn/30" : ""}`}
          disabled={priceUpCount === 0}
        >
          <div className="label mb-1">Подорожали</div>
          <div
            className={`stat-num ${priceUpCount > 0 ? "text-warn" : "text-muted"}`}
          >
            {priceUpCount}
          </div>
          <div className="text-xs text-muted mt-1">
            {priceUpCount > 0
              ? "клик — показать только их"
              : "за всю историю"}
          </div>
        </button>
      </div>

      {/* Cadence filter — three mutually-exclusive pills + "Все". Hidden
          when nothing has been detected yet (the empty-state card
          handles that case). */}
      {allCandidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted mr-1">Период:</span>
          {(["all", "monthly", "weekly", "quarterly"] as const).map((c) => {
            const label = c === "all" ? "Все" : CADENCE_LABEL[c];
            const count =
              c === "all"
                ? allCandidates.length
                : allCandidates.filter((x) => x.cadence === c).length;
            const active = cadenceFilter === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCadenceFilter(c)}
                className={`px-3 py-1 rounded-full border transition-colors ${
                  active
                    ? "bg-accent/10 border-accent/40 text-accent"
                    : "border-border text-muted hover:text-text"
                }`}
              >
                {label}
                <span className="ml-1.5 opacity-60">{count}</span>
              </button>
            );
          })}
          <span className="text-border">·</span>
          <button
            type="button"
            onClick={() => setOnlyActive((v) => !v)}
            title="Скрыть давно не повторявшиеся (последний платёж больше года назад)"
            className={`px-3 py-1 rounded-full border transition-colors ${
              onlyActive
                ? "bg-accent/10 border-accent/40 text-accent"
                : "border-border text-muted hover:text-text"
            }`}
          >
            Только активные
            <span className="ml-1.5 opacity-60">{activeCount}</span>
          </button>
          {onlyPriceUp && (
            <button
              type="button"
              onClick={() => setOnlyPriceUp(false)}
              className="px-3 py-1 rounded-full border border-warn/40 bg-warn/10 text-warn"
            >
              Только подорожавшие ×
            </button>
          )}
        </div>
      )}

      {candidates.length === 0 && (
        <div className="card card-pad text-center py-12">
          <AlertCircle className="w-10 h-10 text-muted mx-auto mb-3" />
          <div className="font-medium mb-1">Регулярных платежей не найдено</div>
          <div className="text-sm text-muted">
            Нужно минимум 3 повтора одного получателя с интервалом ~раз в месяц.
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="card card-pad">
          <div className="font-semibold mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-accent" />
            Ближайшие ожидаемые
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {upcoming.slice(0, 6).map((c) => {
              const daysUntil = Math.round(
                (+new Date(c.nextExpected) - +new Date(today)) / 86400000
              );
              return (
                <button
                  key={c.payee + c.currency}
                  onClick={() => openCandidate(c)}
                  className="text-left p-3 rounded-lg bg-panel2 border border-border hover:border-accent transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-medium text-sm truncate">{c.payee}</div>
                    <div className="text-xs pill shrink-0 ml-2">
                      {daysUntil === 0 ? "сегодня" : `через ${daysUntil} дн.`}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>{formatDate(c.nextExpected, "short")}</span>
                    <span className="text-expense font-semibold tabular-nums">
                      ≈ {formatMoney(c.avgAmount, c.currency)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {candidates.length > 0 && (
        <div className="card card-pad">
          <div className="font-semibold mb-3">Все регулярные платежи</div>
          <SortableTable<RecurringCandidate>
            data={candidates}
            rowKey={(c) => c.payee + c.currency}
            defaultSortKey="totalSpent"
            defaultSortDir="desc"
            onRowClick={openCandidate}
            exportName="recurring_payments"
            columns={
              [
                {
                  key: "payee",
                  label: "Получатель",
                  sortValue: (c) => c.payee,
                  render: (c) => (
                    <span className="font-medium truncate max-w-[180px] inline-block" title={c.payee}>
                      {c.payee}
                    </span>
                  ),
                },
                {
                  key: "category",
                  label: "Категория",
                  sortValue: (c) => c.category,
                  render: (c) => (
                    <span className="text-muted truncate max-w-[120px] inline-block">
                      {c.category}
                    </span>
                  ),
                },
                {
                  key: "avgAmount",
                  label: "Сумма ср.",
                  align: "right",
                  sortValue: (c) => c.avgAmount,
                  render: (c) => (
                    <span className="tabular-nums">
                      {formatMoney(c.avgAmount, c.currency)}
                    </span>
                  ),
                },
                {
                  // Price-trend column — shows a small arrow + the %
                  // change of the *last* charge vs. the historical
                  // average. Empty cell for "flat" so the column stays
                  // visually quiet on the (majority) stable subscriptions.
                  key: "priceTrend",
                  label: "Изменение",
                  align: "right",
                  sortValue: (c) => c.priceTrend.changePct,
                  render: (c) => {
                    const { priceFlag, changePct } = c.priceTrend;
                    if (priceFlag === "flat") {
                      return <span className="text-muted">—</span>;
                    }
                    const pct = (changePct * 100).toFixed(0);
                    const Icon = priceFlag === "up" ? TrendingUp : TrendingDown;
                    return (
                      <span
                        className={`inline-flex items-center gap-1 tabular-nums ${
                          priceFlag === "up" ? "text-warn" : "text-income"
                        }`}
                        title={
                          priceFlag === "up"
                            ? "Последний платёж дороже исторического среднего"
                            : "Последний платёж дешевле исторического среднего"
                        }
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {priceFlag === "up" ? "+" : ""}
                        {pct}%
                      </span>
                    );
                  },
                },
                {
                  key: "avgInterval",
                  label: "Раз в",
                  align: "right",
                  sortValue: (c) => c.avgIntervalDays,
                  render: (c) => <span className="text-muted">{c.avgIntervalDays} дн</span>,
                },
                {
                  key: "occurrences",
                  label: "Повторов",
                  align: "right",
                  sortValue: (c) => c.occurrences,
                  render: (c) => <span className="text-muted">{formatNum(c.occurrences)}</span>,
                },
                {
                  key: "consistency",
                  label: "Стабильность",
                  align: "right",
                  sortValue: (c) => c.consistency,
                  render: (c) => (
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-12 h-1.5 bg-panel2 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent"
                          style={{ width: `${c.consistency * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted tabular-nums w-10 text-right">
                        {(c.consistency * 100).toFixed(0)}%
                      </span>
                    </div>
                  ),
                },
                {
                  key: "lastDate",
                  label: "Последний",
                  sortValue: (c) => c.lastDate,
                  render: (c) => (
                    <span className="text-muted whitespace-nowrap">
                      {formatDate(c.lastDate, "short")}
                    </span>
                  ),
                },
                {
                  key: "nextExpected",
                  label: "Следующий",
                  sortValue: (c) => c.nextExpected,
                  render: (c) => (
                    <span className="text-muted whitespace-nowrap">
                      {formatDate(c.nextExpected, "short")}
                    </span>
                  ),
                },
                {
                  key: "totalSpent",
                  label: "Итого",
                  align: "right",
                  sortValue: (c) => c.totalSpent,
                  render: (c) => (
                    <span className="tabular-nums text-expense font-medium">
                      {formatMoney(c.totalSpent, c.currency)}
                    </span>
                  ),
                },
              ] as Column<RecurringCandidate>[]
            }
          />
        </div>
      )}
    </div>
  );
}
