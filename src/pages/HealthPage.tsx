import { useEffect, useMemo, useState } from "react";
import {
  HeartPulse,
  TrendingUp,
  ShieldCheck,
  Tag as TagIcon,
  Repeat,
  Lock,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { buildObligatorySet } from "../lib/aggregations";
import { useOffBalanceStore } from "../store/useOffBalanceStore";
import {
  getLiveAccountsFromCache,
  type LiveAccount,
} from "../store/useZenmoneyStore";
import { computeHealthScore, type HealthComponent } from "../lib/health";
import { formatPct } from "../lib/format";
import { EmptyState } from "../components/EmptyState";

const COMPONENT_ICONS: Record<string, typeof HeartPulse> = {
  savings_rate: TrendingUp,
  emergency_fund: ShieldCheck,
  uncategorized: TagIcon,
  stability: Repeat,
  fixed_load: Lock,
};

function formatValue(c: HealthComponent): string {
  if (c.value === null) return "—";
  switch (c.id) {
    case "savings_rate":
    case "uncategorized":
    case "fixed_load":
      return formatPct(c.value, 1);
    case "emergency_fund":
      return `${c.value.toFixed(1)} мес`;
    case "stability":
      return `CV ${c.value.toFixed(2)}`;
    default:
      return c.value.toFixed(2);
  }
}

function statusColor(status: HealthComponent["status"]): string {
  switch (status) {
    case "good":
      return "text-income";
    case "fair":
      return "text-warn";
    case "poor":
      return "text-expense";
    default:
      return "text-muted";
  }
}

function statusLabel(status: HealthComponent["status"]): string {
  switch (status) {
    case "good":
      return "хорошо";
    case "fair":
      return "терпимо";
    case "poor":
      return "слабо";
    default:
      return "нет данных";
  }
}

function gradeColor(grade: string): string {
  if (grade === "A+" || grade === "A") return "text-income";
  if (grade === "B" || grade === "C") return "text-warn";
  return "text-expense";
}

export function HealthPage() {
  const transactions = useDataStore((s) => s.transactions);
  const rates = useDataStore((s) => s.rates);
  const baseCurrency = rates.base;
  const calibration = useCalibrationStore((s) => s.calibration);
  const includeOffBalance = useOffBalanceStore((s) => s.includeOffBalance);
  const [liveAccounts, setLiveAccounts] = useState<LiveAccount[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getLiveAccountsFromCache().then((d) => {
      if (!cancelled) setLiveAccounts(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const calibLoaded = useCalibrationStore((s) => s.loaded);
  const hydrateCalibration = useCalibrationStore((s) => s.hydrate);
  const categoryMeta = useCategoryMetaStore((s) => s.meta);
  const metaLoaded = useCategoryMetaStore((s) => s.loaded);
  const hydrateMeta = useCategoryMetaStore((s) => s.hydrate);

  useEffect(() => {
    if (!calibLoaded) hydrateCalibration();
    if (!metaLoaded) hydrateMeta();
  }, [calibLoaded, hydrateCalibration, metaLoaded, hydrateMeta]);

  const score = useMemo(() => {
    const obligatoryCategories = buildObligatorySet(transactions, categoryMeta);
    // Off-balance accounts' total — added to the emergency fund. When «include
    // off-balance» is on, the net-worth calibration already counts them, so we
    // add nothing extra (avoids double-counting).
    const toBase = (amt: number, cur: string) =>
      cur === rates.base ? amt : amt * (rates.rates[cur] || 1);
    const extraLiquid =
      includeOffBalance || !liveAccounts
        ? 0
        : liveAccounts
            .filter((a) => !a.archive && !a.inBalance)
            .reduce((s, a) => s + toBase(a.balance, a.currency), 0);

    return computeHealthScore({
      transactions,
      baseCurrency,
      calibration,
      obligatoryCategories,
      extraLiquid,
    });
  }, [transactions, rates, baseCurrency, calibration, categoryMeta, includeOffBalance, liveAccounts]);

  if (transactions.length === 0) return <EmptyState />;

  const poorComponents = score.components.filter((c) => c.status === "poor");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <HeartPulse className="w-6 h-6 text-accent" />
          Финансовое здоровье
        </h1>
        <p className="text-muted text-sm mt-1">
          Единый интегральный показатель на основе 5 метрик. Чем выше — тем
          устойчивее ваше финансовое положение.
        </p>
      </div>

      {/* Overall score */}
      <div className="card card-pad">
        <div className="flex items-center justify-between flex-wrap gap-6">
          <div>
            <div className="label">Общий счёт</div>
            <div className="flex items-baseline gap-3 mt-1">
              <div className={`text-6xl font-bold tabular-nums ${gradeColor(score.grade)}`}>
                {score.overall}
              </div>
              <div className={`text-3xl font-semibold ${gradeColor(score.grade)}`}>
                {score.grade}
              </div>
            </div>
            <div className="text-xs text-muted mt-2 max-w-md">
              Взвешенное среднее по компонентам ниже. Шкала: A+ 90+ · A 80+ ·
              B 70+ · C 60+ · D 50+ · E ниже 50.
            </div>
          </div>

          <div className="flex-1 min-w-[200px] max-w-[400px]">
            <div className="h-3 rounded-full overflow-hidden bg-panel2">
              <div
                className={`h-full ${
                  score.overall >= 75
                    ? "bg-income"
                    : score.overall >= 50
                      ? "bg-warn"
                      : "bg-expense"
                }`}
                style={{ width: `${score.overall}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted mt-1">
              <span>0</span>
              <span>50</span>
              <span>75</span>
              <span>100</span>
            </div>
          </div>
        </div>
      </div>

      {/* Components */}
      <div className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted px-1">
          Компоненты
        </div>
        {score.components.map((c) => {
          const Icon = COMPONENT_ICONS[c.id] || HeartPulse;
          return (
            <div key={c.id} className="card card-pad">
              <div className="flex items-start gap-4">
                <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${statusColor(c.status)}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <div className="font-semibold">{c.label}</div>
                    <div className={`text-xs ${statusColor(c.status)}`}>
                      {statusLabel(c.status)}
                    </div>
                    <div className="text-xs text-muted">
                      вес {c.weight}%
                    </div>
                  </div>
                  <div className="text-xs text-muted mt-1">{c.detail}</div>

                  <div className="flex items-center gap-4 mt-3 flex-wrap">
                    <div className="flex-1 min-w-[160px]">
                      <div className="h-2 rounded-full overflow-hidden bg-panel2">
                        <div
                          className={`h-full ${
                            c.status === "good"
                              ? "bg-income"
                              : c.status === "fair"
                                ? "bg-warn"
                                : c.status === "poor"
                                  ? "bg-expense"
                                  : "bg-muted"
                          }`}
                          style={{ width: `${c.status === "na" ? 0 : c.score}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex gap-4 text-xs">
                      <div>
                        <div className="text-muted">Метрика</div>
                        <div className="font-mono tabular-nums">{formatValue(c)}</div>
                      </div>
                      <div>
                        <div className="text-muted">Балл</div>
                        <div className="font-mono tabular-nums">
                          {c.status === "na" ? "—" : Math.round(c.score)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {c.hint && (
                    <div className="mt-3 text-xs text-text bg-panel2/40 rounded p-2 flex items-start gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-accent2 shrink-0 mt-0.5" />
                      <span>{c.hint}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* What's next */}
      {poorComponents.length > 0 && (
        <div className="card card-pad bg-expense/5 border-expense/40">
          <div className="flex items-center gap-2 font-semibold mb-2">
            <AlertCircle className="w-4 h-4 text-expense" />
            На что обратить внимание в первую очередь
          </div>
          <ul className="space-y-1 text-sm">
            {poorComponents.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <span className="text-expense">•</span>
                <span>
                  <strong>{c.label}</strong>
                  {c.hint ? ` — ${c.hint}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {poorComponents.length === 0 && score.overall >= 75 && (
        <div className="card card-pad bg-income/5 border-income/40">
          <div className="flex items-center gap-2 text-income font-semibold">
            <CheckCircle2 className="w-4 h-4" />
            Всё под контролем. Держите этот ритм и думайте про инвестиции.
          </div>
        </div>
      )}
    </div>
  );
}
