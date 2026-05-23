import { useEffect, useMemo, useState } from "react";
import { Tag, AlertCircle, Sparkles, Wand2, CheckCircle2 } from "lucide-react";
import { useDataStore } from "../store/useDataStore";
import { useDrillStore } from "../store/useDrillStore";
import { useCategoryRulesStore } from "../store/useCategoryRulesStore";
import {
  detectUncategorized,
  suggestCategoriesForUncategorized,
  type CategorySuggestion,
} from "../lib/aggregations";
import { formatMoney, formatDate, formatNum, formatPct } from "../lib/format";
import { kindColorClass, kindGlyphClass, kindSignGlyph } from "../lib/txKindStyle";
import { EmptyState } from "../components/EmptyState";
import { SortableTable, type Column } from "../components/SortableTable";
import type { Transaction } from "../types";

export function UncategorizedPage() {
  const transactions = useDataStore((s) => s.transactions);
  const base = useDataStore((s) => s.rates.base);
  const showDrill = useDrillStore((s) => s.show);

  const list = useMemo(() => detectUncategorized(transactions), [transactions]);
  const total = list.reduce((s, t) => s + t.amountBase, 0);
  const allTotal = transactions
    .filter((t) => t.kind !== "transfer")
    .reduce((s, t) => s + t.amountBase, 0);
  const share = allTotal > 0 ? total / allTotal : 0;

  const addRule = useCategoryRulesStore((s) => s.add);
  const addManyRules = useCategoryRulesStore((s) => s.addMany);
  const rulesLoaded = useCategoryRulesStore((s) => s.loaded);
  const rulesHydrate = useCategoryRulesStore((s) => s.hydrate);
  const reapplyRules = useDataStore((s) => s.reapplyRules);
  useEffect(() => {
    if (!rulesLoaded) rulesHydrate();
  }, [rulesLoaded, rulesHydrate]);

  const [showSuggestions, setShowSuggestions] = useState(true);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const suggestions = useMemo<CategorySuggestion[]>(
    () => (showSuggestions ? suggestCategoriesForUncategorized(transactions, list, 7) : []),
    [transactions, list, showSuggestions]
  );

  async function applyOne(s: CategorySuggestion) {
    if (!s.payee) return;
    setBusy(true);
    await addRule({
      enabled: true,
      field: "payee",
      op: "contains",
      value: s.payee,
      caseInsensitive: true,
      category: s.suggested,
    });
    setAppliedIds((prev) => new Set(prev).add(s.txId));
    await reapplyRules();
    setBusy(false);
  }

  async function applyAllConfident() {
    const confident = suggestions.filter(
      (s) => s.confidence >= 0.7 && s.payee && !appliedIds.has(s.txId)
    );
    if (confident.length === 0) return;
    if (!confirm(`Создать ${confident.length} правил автоматически?`)) return;
    setBusy(true);
    await addManyRules(
      confident.map((s) => ({
        enabled: true,
        field: "payee",
        op: "contains",
        value: s.payee,
        caseInsensitive: true,
        category: s.suggested,
      }))
    );
    setAppliedIds((prev) => {
      const next = new Set(prev);
      for (const s of confident) next.add(s.txId);
      return next;
    });
    await reapplyRules();
    setBusy(false);
  }

  if (transactions.length === 0) return <EmptyState />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Tag className="w-6 h-6 text-accent" />
          Незакатегоризованные
        </h1>
        <p className="text-muted text-sm mt-1">
          Операции с категориями «Прочие» / «Без категории» / пустыми. Подсветить пробелы для чистки в Дзен-мани.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="card card-pad">
          <div className="label mb-1">Найдено</div>
          <div className="stat-num">{formatNum(list.length)}</div>
          <div className="text-xs text-muted mt-1">из {formatNum(transactions.length)} всего</div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Сумма</div>
          <div className="stat-num text-warn">
            {formatMoney(total, base, { compact: true })}
          </div>
        </div>
        <div className="card card-pad">
          <div className="label mb-1">Доля от всех потоков</div>
          <div className="stat-num">{(share * 100).toFixed(1)}%</div>
        </div>
      </div>

      {/* Smart suggestions */}
      {list.length > 0 && suggestions.length > 0 && (
        <div className="card card-pad bg-accent2/5 border-accent2/40">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
            <div>
              <div className="font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent2" />
                Подсказки категорий ({suggestions.length})
              </div>
              <div className="text-xs text-muted mt-1">
                Подобраны по похожести получателя, комментария и категории. Применение
                создаёт правило (по получателю) — можно отменить на странице «Правила».
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={applyAllConfident}
                disabled={
                  busy ||
                  suggestions.filter((s) => s.confidence >= 0.7 && !appliedIds.has(s.txId)).length === 0
                }
                className="btn-primary text-xs"
              >
                <Wand2 className="w-3.5 h-3.5" />
                Применить уверенные (
                {suggestions.filter((s) => s.confidence >= 0.7 && !appliedIds.has(s.txId)).length}
                )
              </button>
              <button
                onClick={() => setShowSuggestions(false)}
                className="btn-ghost text-xs text-muted"
                title="Скрыть подсказки"
              >
                ×
              </button>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto space-y-1">
            {suggestions.slice(0, 50).map((s) => {
              const applied = appliedIds.has(s.txId);
              return (
                <div
                  key={s.txId}
                  className={`flex items-center gap-3 p-2 rounded text-sm ${
                    applied ? "bg-income/10" : "bg-panel2/40 hover:bg-panel2/70"
                  }`}
                >
                  <div className="text-xs text-muted whitespace-nowrap tabular-nums w-20">
                    {formatDate(s.date, "short")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{s.payee || "—"}</div>
                    {s.comment && (
                      <div className="text-xs text-muted truncate">{s.comment}</div>
                    )}
                  </div>
                  <div className="text-xs whitespace-nowrap text-expense font-medium tabular-nums">
                    {formatMoney(s.amount, s.currency)}
                  </div>
                  <div className="text-xs text-muted">→</div>
                  <div className="pill text-xs whitespace-nowrap" title={s.suggested}>
                    {s.suggested.length > 28 ? s.suggested.slice(0, 28) + "…" : s.suggested}
                  </div>
                  <div
                    className={`text-xs tabular-nums w-12 text-right ${
                      s.confidence >= 0.7
                        ? "text-income"
                        : s.confidence >= 0.4
                          ? "text-warn"
                          : "text-muted"
                    }`}
                    title={`Похожесть на: ${s.reasonExamples.join(", ") || "—"}`}
                  >
                    {formatPct(s.confidence, 0)}
                  </div>
                  <button
                    onClick={() => applyOne(s)}
                    disabled={busy || applied || !s.payee}
                    className={`btn-ghost !p-1.5 text-xs ${
                      applied ? "text-income" : ""
                    }`}
                    title={applied ? "Применено" : "Применить как правило"}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
          {suggestions.length > 50 && (
            <div className="text-xs text-muted text-center mt-2">
              Показано 50 из {suggestions.length}
            </div>
          )}
        </div>
      )}

      {list.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <AlertCircle className="w-10 h-10 text-income mx-auto mb-3" />
          <div className="font-medium mb-1">Все операции категоризированы — отлично!</div>
          <div className="text-sm text-muted">
            Не найдено операций с пустыми или «прочими» категориями
          </div>
        </div>
      ) : (
        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">Все незакатегоризованные ({list.length})</div>
            <button
              onClick={() => showDrill("Незакатегоризованные", list, "Чистка категорий")}
              className="btn-ghost text-xs"
            >
              Открыть в drawer
            </button>
          </div>
          <SortableTable<Transaction>
            data={list}
            rowKey={(t) => t.id}
            defaultSortKey="date"
            defaultSortDir="desc"
            limit={200}
            exportName="uncategorized"
            columns={
              [
                {
                  key: "date",
                  label: "Дата",
                  sortValue: (t) => t.date,
                  render: (t) => (
                    <span className="whitespace-nowrap text-muted">
                      {formatDate(t.date, "short")}
                    </span>
                  ),
                },
                {
                  key: "category",
                  label: "Категория",
                  sortValue: (t) => t.categoryFull,
                  render: (t) => (
                    <span className="truncate max-w-[150px] inline-block text-warn">
                      {t.categoryFull || "—"}
                    </span>
                  ),
                },
                {
                  key: "payee",
                  label: "Получатель",
                  sortValue: (t) => t.payee || "",
                  render: (t) => (
                    <span className="truncate max-w-[160px] inline-block">
                      {t.payee || "—"}
                    </span>
                  ),
                },
                {
                  key: "comment",
                  label: "Комментарий",
                  sortValue: (t) => t.comment,
                  render: (t) => (
                    <span
                      className="truncate max-w-[280px] inline-block text-xs text-muted"
                      title={t.comment}
                    >
                      {t.comment}
                    </span>
                  ),
                },
                {
                  key: "amount",
                  label: "Сумма",
                  align: "right",
                  sortValue: (t) => t.amountBase,
                  render: (t) => (
                    <span
                      className={`tabular-nums whitespace-nowrap ${kindColorClass(t.kind)}`}
                      title={t.kind === "refund" ? "Возврат — уменьшает расход категории" : undefined}
                    >
                      <span className={kindGlyphClass(t.kind)}>{kindSignGlyph(t.kind)}</span>
                      {formatMoney(t.amount, t.currency)}
                    </span>
                  ),
                },
              ] as Column<Transaction>[]
            }
          />
        </div>
      )}
    </div>
  );
}
