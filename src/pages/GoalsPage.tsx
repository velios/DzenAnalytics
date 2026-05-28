import { useEffect, useMemo, useState } from "react";
import { Target, Plus, Trash2, Flame, Calendar, TrendingUp } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useGoalsStore } from "../store/useGoalsStore";
import { confirm } from "../store/useConfirmStore";
import { groupByMonth } from "../lib/aggregations";
import { formatMoney, formatDate } from "../lib/format";
import { EmptyState } from "../components/EmptyState";

function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export function GoalsPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const goals = useGoalsStore((s) => s.goals);
  const addGoal = useGoalsStore((s) => s.add);
  const updateGoal = useGoalsStore((s) => s.update);
  const removeGoal = useGoalsStore((s) => s.remove);
  const hydrate = useGoalsStore((s) => s.hydrate);
  const loaded = useGoalsStore((s) => s.loaded);

  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);

  const months = useMemo(() => groupByMonth(transactions), [transactions]);
  const recent = months.slice(-6);
  const avgIncome = recent.length
    ? recent.reduce((s, m) => s + m.income, 0) / recent.length
    : 0;
  const avgExpense = recent.length
    ? recent.reduce((s, m) => s + m.expense, 0) / recent.length
    : 0;
  const avgSavings = avgIncome - avgExpense;
  const savingsRate = avgIncome > 0 ? avgSavings / avgIncome : 0;
  const annualExpense = avgExpense * 12;
  const fireTarget = annualExpense * 25;
  const yearsToFire = avgSavings > 0 ? (fireTarget - 0) / (avgSavings * 12) : Infinity;

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [current, setCurrent] = useState("");
  const [deadline, setDeadline] = useState("");

  function submit() {
    const t = Number(target);
    const c = Number(current) || 0;
    if (!name.trim() || !Number.isFinite(t) || t <= 0) return;
    addGoal({
      name: name.trim(),
      target: t,
      current: c,
      deadline: deadline || null,
    });
    setName("");
    setTarget("");
    setCurrent("");
    setDeadline("");
    setAdding(false);
  }

  if (transactions.length === 0) return <EmptyState />;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="w-6 h-6 text-accent shrink-0" />
            Цели
          </h1>
          <p className="text-muted text-sm mt-1">
            Копите на конкретные цели и оцените, сколько лет до финансовой свободы при текущем темпе.
          </p>
        </div>
        <button onClick={() => setAdding(!adding)} className="btn-primary text-sm">
          <Plus className="w-4 h-4" />
          Цель
        </button>
      </div>

      <div className="card card-pad">
        <div className="flex items-center gap-2 mb-3">
          <Flame className="w-5 h-5 text-warn" />
          <span className="font-semibold">FIRE — финансовая независимость</span>
        </div>
        <p className="text-xs text-muted mb-4">
          «Magic number» = годовой расход × 25 (правило 4%). Когда накопления достигнут этого уровня,
          доход с инвестиций (~4% годовых) покроет ваши расходы, и работать ради денег уже не обязательно.
          Считается на основе средних за последние 6 мес.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card card-pad bg-panel2">
            <div className="label mb-1">Норма сбережений</div>
            <div className={`stat-num ${savingsRate > 0 ? "text-income" : "text-expense"}`}>
              {(savingsRate * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-muted mt-1">
              {avgSavings > 0
                ? `+${formatMoney(avgSavings, base, { compact: true })}/мес`
                : `−${formatMoney(-avgSavings, base, { compact: true })}/мес`}
            </div>
          </div>
          <div className="card card-pad bg-panel2">
            <div className="label mb-1">Годовой расход</div>
            <div className="stat-num">{formatMoney(annualExpense, base, { compact: true })}</div>
            <div className="text-xs text-muted mt-1">средний за 6 мес × 12</div>
          </div>
          <div className="card card-pad bg-panel2">
            <div className="label mb-1">Целевой капитал</div>
            <div className="stat-num text-accent">
              {formatMoney(fireTarget, base, { compact: true })}
            </div>
            <div className="text-xs text-muted mt-1">×25 от годового расхода</div>
          </div>
          <div className="card card-pad bg-panel2">
            <div className="label mb-1">Лет до FIRE</div>
            <div className="stat-num text-warn">
              {Number.isFinite(yearsToFire) && yearsToFire > 0
                ? yearsToFire.toFixed(1)
                : "—"}
            </div>
            <div className="text-xs text-muted mt-1">от текущего нуля</div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-xs text-muted mb-2">
            Сценарии при изменении нормы сбережений:
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[0.1, 0.2, 0.3, 0.5].map((rate) => {
              const monthly = avgIncome * rate;
              const years = monthly > 0 ? fireTarget / (monthly * 12) : Infinity;
              return (
                <div
                  key={rate}
                  className={`p-3 rounded-lg border text-sm ${
                    Math.abs(rate - savingsRate) < 0.05
                      ? "bg-accent/10 border-accent"
                      : "bg-panel2 border-border"
                  }`}
                >
                  <div className="font-medium">{(rate * 100).toFixed(0)}% / мес</div>
                  <div className="text-xs text-muted">
                    {Number.isFinite(years) ? `${years.toFixed(0)} лет` : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {adding && (
        <div className="card card-pad bg-accent/5 border-accent/40">
          <div className="font-semibold mb-3">Новая цель</div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              placeholder="Название (например, Машина)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
            />
            <input
              type="number"
              placeholder="Сумма цели"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="input"
            />
            <input
              type="number"
              placeholder="Уже накоплено (опц.)"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="input"
            />
            <input
              type="date"
              placeholder="Дедлайн"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="input"
            />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={submit} className="btn-primary text-sm">
              Сохранить
            </button>
            <button onClick={() => setAdding(false)} className="btn-ghost text-sm">
              Отмена
            </button>
          </div>
        </div>
      )}

      {goals.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <Target className="w-10 h-10 text-muted mx-auto mb-3" />
          <div className="font-medium mb-1">Нет целей</div>
          <div className="text-sm text-muted mb-4">
            Создайте цель, чтобы видеть прогресс и расчётный срок достижения
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {goals.map((g) => {
            const ratio = Math.min(g.current / g.target, 1);
            const remaining = Math.max(g.target - g.current, 0);
            const monthsRemaining =
              avgSavings > 0 ? Math.ceil(remaining / avgSavings) : null;
            const projectedFinish =
              monthsRemaining !== null
                ? new Date(
                    new Date().getFullYear(),
                    new Date().getMonth() + monthsRemaining,
                    1
                  )
                    .toISOString()
                    .slice(0, 10)
                : null;
            const deadlineMonths = g.deadline
              ? monthsBetween(new Date().toISOString(), g.deadline)
              : null;
            const onTrack =
              monthsRemaining !== null &&
              deadlineMonths !== null &&
              monthsRemaining <= deadlineMonths;

            return (
              <div key={g.id} className="card card-pad">
                <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-semibold text-base">{g.name}</div>
                    <div className="text-xs text-muted mt-0.5">
                      {formatMoney(g.current, base, { compact: true })} из{" "}
                      {formatMoney(g.target, base, { compact: true })} ·{" "}
                      {(ratio * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="Накоплено"
                      defaultValue={g.current}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v !== g.current)
                          updateGoal(g.id, { current: v });
                      }}
                      className="input text-sm w-32"
                    />
                    <button
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Удалить цель?",
                          message: `«${g.name}» будет удалена.`,
                          confirmLabel: "Удалить",
                          tone: "danger",
                        });
                        if (ok) removeGoal(g.id);
                      }}
                      className="btn-ghost !p-2 text-muted hover:text-expense"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="h-3 bg-panel2 rounded-full overflow-hidden mb-3">
                  <div
                    className={`h-full rounded-full ${
                      ratio >= 1 ? "bg-income" : "bg-accent"
                    }`}
                    style={{ width: `${ratio * 100}%` }}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-muted">
                    <TrendingUp className="w-3.5 h-3.5" />
                    {monthsRemaining !== null
                      ? `${monthsRemaining} мес при +${formatMoney(avgSavings, base, { compact: true })}/мес`
                      : "Темп сбережений отрицательный — копить нечего"}
                  </div>
                  {projectedFinish && (
                    <div className="flex items-center gap-1.5 text-muted">
                      <Calendar className="w-3.5 h-3.5" />
                      Прогноз: {formatDate(projectedFinish)}
                    </div>
                  )}
                  {g.deadline && (
                    <div
                      className={`flex items-center gap-1.5 ${
                        onTrack ? "text-income" : "text-expense"
                      }`}
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      Дедлайн: {formatDate(g.deadline)} ({onTrack ? "успеваете" : "не успеваете"})
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
