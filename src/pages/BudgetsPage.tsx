import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Target, AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useBudgetsStore } from "../store/useBudgetsStore";
import { groupByCategory } from "../lib/aggregations";
import { formatMoney } from "../lib/format";
import { EmptyState } from "../components/EmptyState";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function dayOfMonth(): number {
  return new Date().getDate();
}

export function BudgetsPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const showDrill = useDrillStore((s) => s.show);
  const budgets = useBudgetsStore((s) => s.budgets);
  const setBudget = useBudgetsStore((s) => s.setBudget);
  const removeBudget = useBudgetsStore((s) => s.removeBudget);
  const hydrate = useBudgetsStore((s) => s.hydrate);
  const loaded = useBudgetsStore((s) => s.loaded);

  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);

  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [newAmount, setNewAmount] = useState("");

  const ym = currentMonth();
  const dim = daysInMonth(ym);
  const dom = dayOfMonth();
  const monthProgress = dom / dim;

  const monthTxs = useMemo(
    () => transactions.filter((t) => t.kind === "expense" && t.date.startsWith(ym)),
    [transactions, ym]
  );

  const spentByCat = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of monthTxs) {
      map.set(t.category, (map.get(t.category) || 0) + t.amountBase);
    }
    return map;
  }, [monthTxs]);

  const allCategories = useMemo(
    () => groupByCategory(transactions, "top").filter((c) => c.expense > 0).map((c) => c.category),
    [transactions]
  );

  const budgetEntries = Object.entries(budgets).sort(([a], [b]) => a.localeCompare(b, "ru"));

  function openCategory(cat: string) {
    const txs = monthTxs.filter((t) => t.category === cat);
    showDrill(`${cat} · ${ym}`, txs, "Расходы по бюджету");
  }

  function addBudget() {
    const amt = Number(newAmount);
    if (!newCat || !amt || amt <= 0) return;
    setBudget(newCat, amt);
    setNewCat("");
    setNewAmount("");
    setAdding(false);
  }

  if (transactions.length === 0) return <EmptyState />;

  const totalBudget = Object.values(budgets).reduce((s, v) => s + v, 0);
  const totalSpent = budgetEntries.reduce((s, [c]) => s + (spentByCat.get(c) || 0), 0);
  const totalProj = totalBudget > 0 && monthProgress > 0 ? totalSpent / monthProgress : 0;

  const availableCategories = allCategories.filter((c) => !(c in budgets));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="w-6 h-6 text-accent" />
            Бюджеты на {ym}
          </h1>
          <p className="text-muted text-sm mt-1">
            Месячные лимиты по категориям. День {dom} из {dim} ({(monthProgress * 100).toFixed(0)}%
            месяца). Прогноз — линейная экстраполяция текущего темпа.
          </p>
        </div>
        <button onClick={() => setAdding(!adding)} className="btn-primary text-sm">
          <Plus className="w-4 h-4" />
          Бюджет
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card card-pad">
          <div className="label mb-1">Всего лимитов</div>
          <div className="stat-num">{formatMoney(totalBudget, base, { compact: true })}</div>
          <div className="text-xs text-muted mt-1">{budgetEntries.length} категорий</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Потрачено</div>
          <div className="stat-num text-expense">
            {formatMoney(totalSpent, base, { compact: true })}
          </div>
          <div className="text-xs text-muted mt-1">
            {totalBudget > 0 ? `${((totalSpent / totalBudget) * 100).toFixed(0)}% от лимитов` : "—"}
          </div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Прогноз на месяц</div>
          <div className={`stat-num ${totalProj > totalBudget ? "text-expense" : "text-warn"}`}>
            {totalProj > 0 ? formatMoney(totalProj, base, { compact: true }) : "—"}
          </div>
          <div className="text-xs text-muted mt-1">При текущем темпе</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Резерв</div>
          <div
            className={`stat-num ${totalBudget - totalSpent < 0 ? "text-expense" : "text-income"}`}
          >
            {formatMoney(totalBudget - totalSpent, base, { compact: true, signed: true })}
          </div>
          <div className="text-xs text-muted mt-1">Лимит минус факт</div>
        </div>
      </div>

      {adding && (
        <div className="card card-pad bg-accent/5 border-accent/40">
          <div className="font-semibold mb-3">Новый бюджет</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              className="input"
            >
              <option value="">— выберите категорию —</option>
              {availableCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="number"
              placeholder={`Лимит в ${base} / мес`}
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              className="input"
            />
            <div className="flex gap-2">
              <button onClick={addBudget} className="btn-primary flex-1 text-sm">
                Сохранить
              </button>
              <button onClick={() => setAdding(false)} className="btn-ghost text-sm">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {budgetEntries.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <Target className="w-10 h-10 text-muted mx-auto mb-3" />
          <div className="font-medium mb-1">Нет настроенных бюджетов</div>
          <div className="text-sm text-muted mb-4">
            Установите месячные лимиты по категориям, чтобы видеть прогресс
          </div>
          {!adding && (
            <button onClick={() => setAdding(true)} className="btn-primary text-sm">
              <Plus className="w-4 h-4" />
              Создать первый бюджет
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {budgetEntries.map(([cat, limit]) => {
            const spent = spentByCat.get(cat) || 0;
            const ratio = spent / limit;
            const projected = monthProgress > 0 ? spent / monthProgress : 0;
            const projOver = projected - limit;
            const remaining = limit - spent;

            const tone =
              ratio >= 1
                ? "expense"
                : ratio >= 0.8
                  ? "warn"
                  : "income";
            const toneClass = {
              expense: "text-expense",
              warn: "text-warn",
              income: "text-income",
            }[tone];
            const barClass = {
              expense: "bg-expense",
              warn: "bg-warn",
              income: "bg-income",
            }[tone];
            const Icon = ratio >= 1 ? AlertTriangle : ratio >= 0.8 ? TrendingUp : CheckCircle2;

            return (
              <div key={cat} className="card card-pad">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="min-w-0">
                    <button
                      onClick={() => openCategory(cat)}
                      className="font-medium text-base hover:text-accent text-left"
                    >
                      {cat}
                    </button>
                    <div className="text-xs text-muted mt-0.5">
                      Лимит: {formatMoney(limit, base, { compact: true })} / мес
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className={`text-lg font-semibold tabular-nums ${toneClass}`}>
                        {formatMoney(spent, base, { compact: true })}
                      </div>
                      <div className="text-xs text-muted">
                        {(ratio * 100).toFixed(0)}% израсходовано
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        if (confirm(`Удалить бюджет на «${cat}»?`)) removeBudget(cat);
                      }}
                      className="btn-ghost !p-2 text-muted hover:text-expense"
                      title="Удалить бюджет"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="relative h-3 bg-panel2 rounded-full overflow-hidden mb-2">
                  <div
                    className="absolute top-0 bottom-0 left-0 w-px bg-text/40 z-10"
                    style={{ left: `${Math.min(monthProgress, 1) * 100}%` }}
                    title={`Прошло ${(monthProgress * 100).toFixed(0)}% месяца`}
                  />
                  <div
                    className={`h-full ${barClass} transition-all`}
                    style={{ width: `${Math.min(ratio, 1) * 100}%` }}
                  />
                  {ratio > 1 && (
                    <div className="absolute right-0 top-0 bottom-0 px-2 flex items-center text-[10px] font-bold text-white">
                      +{((ratio - 1) * 100).toFixed(0)}%
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs text-muted">
                  <div className="flex items-center gap-1.5">
                    <Icon className={`w-3.5 h-3.5 ${toneClass}`} />
                    <span>
                      {ratio >= 1
                        ? "Лимит превышен"
                        : ratio >= 0.8
                          ? "Близко к лимиту"
                          : "В пределах"}
                    </span>
                  </div>
                  <div>
                    Прогноз:{" "}
                    <span className={`tabular-nums ${projOver > 0 ? "text-expense" : "text-text"}`}>
                      {formatMoney(projected, base, { compact: true })}
                    </span>
                  </div>
                  <div className="text-right">
                    Осталось:{" "}
                    <span className={`tabular-nums ${remaining < 0 ? "text-expense" : "text-income"}`}>
                      {formatMoney(remaining, base, { compact: true, signed: true })}
                    </span>
                  </div>
                </div>

                {projOver > 0 && (
                  <div className="text-xs text-warn mt-2">
                    ⚠ При текущем темпе перерасход составит ≈
                    {formatMoney(projOver, base, { compact: true })}
                  </div>
                )}

                {monthTxs.filter((t) => t.category === cat).length > 0 && (
                  <button
                    onClick={() => openCategory(cat)}
                    className="text-xs text-accent hover:underline mt-2"
                  >
                    {monthTxs.filter((t) => t.category === cat).length} операций →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
