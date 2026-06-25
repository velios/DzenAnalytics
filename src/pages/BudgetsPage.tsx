import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Target,
  Wallet,
  Copy,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useBudgetsStore } from "../store/useBudgetsStore";
import { confirm } from "../store/useConfirmStore";
import { groupByCategory } from "../lib/aggregations";
import {
  plannedFor,
  factFor,
  addMonths,
  type BudgetKind,
  type Recurrence,
  type BudgetLine,
} from "../lib/budgets";
import { formatMoney } from "../lib/format";
import { loadZenCache } from "../lib/zenmoneyCache";
import { zenPlansFromBudgets, zenPlanKey } from "../lib/zenBudgets";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { DateField } from "../components/DateField";

const RU_MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${RU_MONTHS[m - 1]} ${y}`;
}
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

const RECUR_LABEL: Record<Recurrence, string> = {
  monthly: "Ежемесячно",
  quarterly: "Ежеквартально",
  yearly: "Ежегодно",
  once: "Разово",
};

interface Row {
  line: BudgetLine;
  planned: number;
  fact: number;
}

export function BudgetsPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const showDrill = useDrillStore((s) => s.show);
  const lines = useBudgetsStore((s) => s.lines);
  const addLine = useBudgetsStore((s) => s.addLine);
  const updateLine = useBudgetsStore((s) => s.updateLine);
  const removeLine = useBudgetsStore((s) => s.removeLine);
  const setOverride = useBudgetsStore((s) => s.setOverride);
  const hydrate = useBudgetsStore((s) => s.hydrate);
  const loaded = useBudgetsStore((s) => s.loaded);

  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);

  // «План из Дзена» (pull-only): read the cached Zenmoney budgets and map them
  // to per-(kind, category, month) amounts. Re-read when the dataset changes
  // (a sync refreshes both transactions and the cache).
  const [zenPlans, setZenPlans] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let alive = true;
    loadZenCache()
      .then((cache) => {
        if (alive && cache) setZenPlans(zenPlansFromBudgets(cache.budgets, cache.tags));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [transactions]);

  const cur = currentMonth();
  const [ym, setYm] = useState(cur);
  const isCurrent = ym === cur;
  // Past/future months are "complete" for projection purposes (no linear
  // extrapolation); only the current month is partially elapsed.
  const monthProgress = isCurrent
    ? new Date().getDate() / daysInMonth(ym)
    : 1;

  // ── Add form ──
  const [adding, setAdding] = useState(false);
  const [fKind, setFKind] = useState<BudgetKind>("expense");
  const [fCat, setFCat] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fRecur, setFRecur] = useState<Recurrence>("monthly");
  const [fStart, setFStart] = useState(cur);
  const [fEnd, setFEnd] = useState("");

  const catsByKind = useMemo(() => {
    const top = groupByCategory(transactions, "top");
    return {
      expense: top.filter((c) => c.expense > 0).map((c) => c.category),
      income: top.filter((c) => c.income > 0).map((c) => c.category),
    };
  }, [transactions]);
  const formCats = catsByKind[fKind];

  function resetForm() {
    setFCat("");
    setFAmount("");
    setFRecur("monthly");
    setFStart(cur);
    setFEnd("");
    setAdding(false);
  }
  function submitLine() {
    const amt = Number(fAmount);
    if (!fCat || !amt || amt <= 0 || !fStart) return;
    addLine({
      category: fCat,
      kind: fKind,
      amount: amt,
      recurrence: fRecur,
      startMonth: fStart,
      endMonth: fEnd || null,
    });
    resetForm();
  }

  // Copy the previous month's plan into the current one: for every line, write
  // last month's planned value as a per-month override here, so this month
  // mirrors it (including any tweaks). Skips lines with nothing planned last
  // month and lines already matching, so it doesn't create redundant overrides.
  async function copyFromPrevMonth() {
    const prev = addMonths(ym, -1);
    const ok = await confirm({
      title: "Копировать бюджет?",
      message: `План из «${monthLabel(prev)}» будет скопирован в «${monthLabel(ym)}». Правки этого месяца будут заменены.`,
      confirmLabel: "Копировать",
    });
    if (!ok) return;
    for (const line of lines) {
      const prevPlan = plannedFor(line, prev);
      if (prevPlan <= 0) continue;
      if (plannedFor(line, ym) === prevPlan) continue;
      await setOverride(line.id, ym, prevPlan);
    }
  }

  const rows = useMemo<Row[]>(
    () =>
      lines
        // A line belongs to a month only while it's inside its validity window
        // [startMonth, endMonth]. A budget that starts in June must NOT appear
        // in May/April, even if that category had spending then. Within the
        // window every month is shown (quarterly/yearly off-months read as
        // план 0), so the line stays visible across its whole life.
        .filter(
          (line) =>
            ym >= line.startMonth && (!line.endMonth || ym <= line.endMonth)
        )
        .map((line) => ({
          line,
          planned: plannedFor(line, ym),
          fact: factFor(line, transactions, ym),
        })),
    [lines, ym, transactions]
  );
  const expenseRows = rows.filter((r) => r.line.kind === "expense");
  const incomeRows = rows.filter((r) => r.line.kind === "income");

  function openCategory(cat: string) {
    const txs = transactions.filter(
      (t) => t.category === cat && t.date.startsWith(ym)
    );
    showDrill(`${cat} · ${ym}`, txs, "Бюджет");
  }

  if (transactions.length === 0) return <EmptyState />;

  const expPlan = expenseRows.reduce((s, r) => s + r.planned, 0);
  const expFact = expenseRows.reduce((s, r) => s + r.fact, 0);
  const incPlan = incomeRows.reduce((s, r) => s + r.planned, 0);
  const incFact = incomeRows.reduce((s, r) => s + r.fact, 0);
  // Дельта = доходы − расходы, отдельно по плану и по факту.
  const planDelta = incPlan - expPlan;
  const factDelta = incFact - expFact;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wallet}
        title="Бюджет"
        hint="План и факт по категориям: периодичность, даты, доход и расход."
        right={
          <button onClick={() => setAdding(!adding)} className="btn-primary text-sm">
            <Plus className="w-4 h-4" />
            Добавить категорию
          </button>
        }
      />

      {/* Toolbar: month nav (left) + copy-from-previous (right) */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setYm((m) => addMonths(m, -1))}
            className="btn-ghost !p-2"
            title="Предыдущий месяц"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <DateField
            granularity="month"
            value={ym}
            onChange={(e) => e.target.value && setYm(e.target.value)}
            className="input text-sm font-medium min-w-[150px]"
          />
          <button
            onClick={() => setYm((m) => addMonths(m, 1))}
            className="btn-ghost !p-2"
            title="Следующий месяц"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {!isCurrent && (
            <button
              onClick={() => setYm(cur)}
              className="text-xs text-accent hover:underline ml-1"
            >
              текущий
            </button>
          )}
        </div>
        <button
          onClick={copyFromPrevMonth}
          className="btn-ghost text-sm"
          title={`Скопировать план из «${monthLabel(addMonths(ym, -1))}» в этот месяц`}
        >
          <Copy className="w-4 h-4" />
          Копировать с прошлого месяца
        </button>
      </div>

      {/* Summary: расходы / доходы / дельта — у каждого явные «Факт» и «План» */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PlanFactCard
          title="Общий план расходов"
          fact={expFact}
          plan={expPlan}
          factClass="text-expense"
          base={base}
        />
        <PlanFactCard
          title="Общий план доходов"
          fact={incFact}
          plan={incPlan}
          factClass="text-income"
          base={base}
        />
        <PlanFactCard
          title="Дельта (доходы − расходы)"
          fact={factDelta}
          plan={planDelta}
          factClass={factDelta >= 0 ? "text-income" : "text-expense"}
          signed
          showPct={false}
          base={base}
        />
      </div>

      {/* Add form */}
      {adding && (
        <div className="card card-pad bg-accent/5 border-accent/40">
          <div className="font-semibold mb-3">Новый бюджет</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => { setFKind("expense"); setFCat(""); }}
                className={`flex-1 text-sm py-2 ${fKind === "expense" ? "bg-expense/15 text-expense font-medium" : "text-muted"}`}
              >
                Расход
              </button>
              <button
                type="button"
                onClick={() => { setFKind("income"); setFCat(""); }}
                className={`flex-1 text-sm py-2 ${fKind === "income" ? "bg-income/15 text-income font-medium" : "text-muted"}`}
              >
                Доход
              </button>
            </div>
            <select value={fCat} onChange={(e) => setFCat(e.target.value)} className="input">
              <option value="">— категория —</option>
              {formCats.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input
              type="number"
              placeholder={`Сумма за период, ${base}`}
              value={fAmount}
              onChange={(e) => setFAmount(e.target.value)}
              className="input"
            />
            <select
              value={fRecur}
              onChange={(e) => setFRecur(e.target.value as Recurrence)}
              className="input"
            >
              {(Object.keys(RECUR_LABEL) as Recurrence[]).map((r) => (
                <option key={r} value={r}>{RECUR_LABEL[r]}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted whitespace-nowrap">с</span>
              <DateField
                granularity="month"
                value={fStart}
                onChange={(e) => setFStart(e.target.value)}
                wrapperClassName="flex-1"
                className="input w-full"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted whitespace-nowrap">по</span>
              <DateField
                granularity="month"
                value={fEnd}
                onChange={(e) => setFEnd(e.target.value)}
                placeholder="бессрочно"
                wrapperClassName="flex-1"
                className="input w-full"
              />
            </label>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={submitLine} className="btn-primary text-sm">Сохранить</button>
            <button onClick={resetForm} className="btn-ghost text-sm">Отмена</button>
          </div>
          {fEnd === "" && (
            <p className="text-xs text-muted mt-2">
              «по» пусто = бессрочно. {RECUR_LABEL[fRecur]}
              {fRecur !== "monthly" && fRecur !== "once"
                ? ` — сумма учитывается раз в ${fRecur === "quarterly" ? "квартал" : "год"}, начиная с выбранного месяца.`
                : "."}
            </p>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <Target className="w-10 h-10 text-muted mx-auto mb-3" />
          <div className="font-medium mb-1">На {monthLabel(ym)} бюджетов нет</div>
          <div className="text-sm text-muted mb-4">
            Создайте бюджет с периодичностью и датами, чтобы видеть план и факт
          </div>
          {!adding && (
            <button onClick={() => setAdding(true)} className="btn-primary text-sm">
              <Plus className="w-4 h-4" />
              Добавить категорию
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {expenseRows.length > 0 && (
            <Section
              heading="Расходы"
              summary={`${formatMoney(expFact, base)} / ${formatMoney(expPlan, base)} плана`}
              rows={expenseRows}
              ym={ym}
              isCurrent={isCurrent}
              monthProgress={monthProgress}
              base={base}
              zenPlans={zenPlans}
              onOpen={openCategory}
              setOverride={setOverride}
              updateLine={updateLine}
              removeLine={removeLine}
            />
          )}
          {incomeRows.length > 0 && (
            <Section
              heading="Доходы"
              summary={`${formatMoney(incFact, base)} / ${formatMoney(incPlan, base)} плана`}
              rows={incomeRows}
              ym={ym}
              isCurrent={isCurrent}
              monthProgress={monthProgress}
              base={base}
              zenPlans={zenPlans}
              onOpen={openCategory}
              setOverride={setOverride}
              updateLine={updateLine}
              removeLine={removeLine}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Summary card showing «Факт» (prominent, coloured) and «План» side by side. */
function PlanFactCard({
  title,
  fact,
  plan,
  factClass,
  base,
  signed = false,
  showPct = true,
}: {
  title: string;
  fact: number;
  plan: number;
  factClass: string;
  base: string;
  signed?: boolean;
  showPct?: boolean;
}) {
  const pct = plan > 0 ? Math.round((fact / plan) * 100) : null;
  return (
    <div className="card card-pad">
      <div className="label mb-2">{title}</div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted mb-0.5">Факт</div>
          <div className={`stat-num ${factClass}`}>
            {formatMoney(fact, base, { signed })}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px] uppercase tracking-wide text-muted mb-0.5">План</div>
          <div className="text-xl font-semibold tabular-nums">
            {formatMoney(plan, base, { signed })}
          </div>
        </div>
      </div>
      {showPct && pct !== null && (
        <div className="text-xs text-muted mt-1.5">{pct}% от плана</div>
      )}
    </div>
  );
}

interface SectionProps {
  heading: string;
  summary: string;
  rows: Row[];
  ym: string;
  isCurrent: boolean;
  monthProgress: number;
  base: string;
  /** «kind:category:ym» → planned amount from Zenmoney (pull-only display). */
  zenPlans: Map<string, number>;
  onOpen: (cat: string) => void;
  setOverride: (id: string, ym: string, amount: number | null) => Promise<void>;
  updateLine: (id: string, patch: Partial<BudgetLine>) => Promise<void>;
  removeLine: (id: string) => Promise<void>;
}

function Section({ heading, summary, rows, ...rest }: SectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-lg">{heading}</h2>
        <div className="text-sm text-muted tabular-nums">{summary}</div>
      </div>
      {rows.map((row) => (
        <BudgetRow key={row.line.id} row={row} {...rest} />
      ))}
    </div>
  );
}

interface RowProps extends Omit<SectionProps, "heading" | "summary" | "rows"> {
  row: Row;
}

function BudgetRow({
  row,
  ym,
  isCurrent,
  monthProgress,
  base,
  zenPlans,
  onOpen,
  setOverride,
  updateLine,
  removeLine,
}: RowProps) {
  const { line, planned, fact } = row;
  const isIncome = line.kind === "income";
  const zenPlan = zenPlans.get(zenPlanKey(line.kind, line.category, ym));
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");
  const hasOverride = line.overrides?.[ym] !== undefined;

  const ratio = planned > 0 ? fact / planned : isIncome ? 0 : fact > 0 ? Infinity : 0;
  const projected = monthProgress > 0 ? fact / monthProgress : 0;
  // For income, meeting/exceeding the plan is GOOD; for expense it's BAD.
  const good = isIncome ? ratio >= 1 : ratio < 0.8;
  const near = !isIncome && ratio >= 0.8 && ratio < 1;
  const tone = good ? "income" : near ? "warn" : "expense";
  const toneClass = { income: "text-income", warn: "text-warn", expense: "text-expense" }[tone];
  // Bar fill colour reflects the KIND, not the status: income bars are green,
  // expense bars red. Status still reads from the number/icon colour below.
  const barClass = isIncome ? "bg-income" : "bg-expense";
  const Icon = isIncome
    ? good ? CheckCircle2 : TrendingDown
    : ratio >= 1 ? AlertTriangle : near ? TrendingUp : CheckCircle2;
  const remaining = isIncome ? fact - planned : planned - fact;

  function startEdit() {
    setEditVal(String(planned));
    setEditing(true);
  }
  function commitEdit() {
    const v = Number(editVal);
    if (Number.isFinite(v) && v >= 0) setOverride(line.id, ym, v);
    setEditing(false);
  }
  // "Сделать нормой с этого месяца": make the override the recurring amount and
  // drop overrides from this month on, so the new value carries forward.
  function applyForward() {
    const overrides = Object.fromEntries(
      Object.entries(line.overrides ?? {}).filter(([k]) => k < ym)
    );
    updateLine(line.id, {
      amount: planned,
      overrides: Object.keys(overrides).length ? overrides : undefined,
    });
  }

  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <button
            onClick={() => onOpen(line.category)}
            className="font-medium text-base hover:text-accent text-left"
          >
            {line.category}
          </button>
          <div className="text-xs text-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span className="pill">{RECUR_LABEL[line.recurrence]}</span>
            {editing ? (
              <span className="inline-flex items-center gap-1">
                план:
                <input
                  type="number"
                  autoFocus
                  value={editVal}
                  onChange={(e) => setEditVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  className="input !py-0.5 !px-1.5 w-24 text-xs"
                />
                <button onClick={commitEdit} className="text-income" title="Сохранить">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setEditing(false)} className="text-muted" title="Отмена">
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                план: {formatMoney(planned, base)}
                <button
                  onClick={startEdit}
                  className="text-muted hover:text-accent"
                  title="Изменить план на этот месяц"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </span>
            )}
            {hasOverride && !editing && (
              <>
                <button
                  onClick={() => setOverride(line.id, ym, null)}
                  className="text-accent hover:underline"
                  title="Вернуть к норме"
                >
                  правка месяца ×
                </button>
                <button
                  onClick={applyForward}
                  className="text-accent hover:underline"
                  title="Сделать это значение нормой со следующих месяцев"
                >
                  сделать нормой →
                </button>
              </>
            )}
            {zenPlan !== undefined && !editing && (
              <span
                className="inline-flex items-center gap-1 text-accent2"
                title="План этой категории из Дзен-мани (раздел «Планы»)"
              >
                Дзен: {formatMoney(zenPlan, base)}
                {Math.round(zenPlan) !== Math.round(planned) && (
                  <button
                    onClick={() => setOverride(line.id, ym, zenPlan)}
                    className="hover:underline"
                    title="Взять план из Дзен-мани в этот месяц"
                  >
                    взять
                  </button>
                )}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className={`text-lg font-semibold tabular-nums ${toneClass}`}>
              {formatMoney(fact, base)}
            </div>
            <div className="text-xs text-muted">
              {planned > 0
                ? `${(ratio * 100).toFixed(0)}% ${isIncome ? "плана" : "израсходовано"}`
                : isIncome ? "плана нет" : "вне плана"}
            </div>
          </div>
          <button
            onClick={async () => {
              const ok = await confirm({
                title: "Удалить бюджет?",
                message: `Бюджет «${line.category}» (${RECUR_LABEL[line.recurrence]}) будет удалён.`,
                confirmLabel: "Удалить",
                tone: "danger",
              });
              if (ok) removeLine(line.id);
            }}
            className="btn-ghost !p-2 text-muted hover:text-expense"
            title="Удалить бюджет"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {planned > 0 && (
        <div className="relative h-3 bg-panel2 rounded-full overflow-hidden mb-2">
          {isCurrent && (
            <div
              className="absolute top-0 bottom-0 left-0 w-px bg-text/40 z-10"
              style={{ left: `${Math.min(monthProgress, 1) * 100}%` }}
              title={`Прошло ${(monthProgress * 100).toFixed(0)}% месяца`}
            />
          )}
          <div
            className={`h-full ${barClass} transition-all`}
            style={{ width: `${Math.min(Math.max(ratio, 0), 1) * 100}%` }}
          />
          {!isIncome && ratio > 1 && (
            <div className="absolute right-0 top-0 bottom-0 px-2 flex items-center text-[10px] font-bold text-white">
              +{((ratio - 1) * 100).toFixed(0)}%
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 text-xs text-muted">
        <div className="flex items-center gap-1.5">
          <Icon className={`w-3.5 h-3.5 ${toneClass}`} />
          <span>
            {isIncome
              ? good ? "План выполнен" : "Недобор"
              : ratio >= 1 ? "Лимит превышен" : near ? "Близко к лимиту" : "В пределах"}
          </span>
        </div>
        {isCurrent && planned > 0 && !isIncome ? (
          <div>
            Прогноз:{" "}
            <span className={`tabular-nums ${projected > planned ? "text-expense" : "text-text"}`}>
              {formatMoney(projected, base)}
            </span>
          </div>
        ) : (
          <div />
        )}
        <div className="text-right">
          {isIncome ? "Разница" : "Осталось"}:{" "}
          <span className={`tabular-nums ${remaining < 0 ? "text-expense" : "text-income"}`}>
            {formatMoney(remaining, base, { signed: true })}
          </span>
        </div>
      </div>
    </div>
  );
}
