import { useEffect, useMemo, useState } from "react";
import {
  Search,
  X,
  ChevronDown,
  Filter,
  Bookmark,
  BookmarkPlus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  CalendarRange,
} from "lucide-react";
import clsx from "clsx";
import { useDataStore } from "../store/useDataStore";
import { useFiltersStore, type DatePreset } from "../store/useFiltersStore";
import { useSavedViewsStore } from "../store/useSavedViewsStore";
import { confirm } from "../store/useConfirmStore";
import { monthLabel } from "../lib/format";

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: "30d", label: "30 дней" },
  { value: "3m", label: "3 мес" },
  { value: "6m", label: "6 мес" },
  { value: "12m", label: "12 мес" },
  { value: "ytd", label: "С начала года" },
  { value: "all", label: "Всё" },
];

function MultiSelect({
  label,
  options,
  selected,
  onToggle,
  onReset,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const summary =
    selected.size === 0
      ? `Все (${options.length})`
      : selected.size === 1
        ? Array.from(selected)[0]
        : `Выбрано ${selected.size}`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "btn-ghost text-sm w-full justify-between",
          selected.size > 0 && "border-accent text-accent"
        )}
      >
        <span className="truncate max-w-[180px]">
          {label}: {summary}
        </span>
        <ChevronDown className="w-4 h-4 shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-72 max-h-80 overflow-auto card p-2 right-0">
            <div className="flex items-center justify-between px-2 py-1 mb-1">
              <span className="text-xs text-muted">{options.length} вариантов</span>
              {selected.size > 0 && (
                <button
                  onClick={onReset}
                  className="text-xs text-accent hover:underline"
                >
                  сбросить
                </button>
              )}
            </div>
            {options.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 px-2 py-1.5 hover:bg-panel2 rounded cursor-pointer text-sm"
              >
                <input
                  type="checkbox"
                  checked={selected.has(opt)}
                  onChange={() => onToggle(opt)}
                  className="accent-accent"
                />
                <span className="truncate">{opt}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function GlobalFilters() {
  const transactions = useDataStore((s) => s.transactions);
  const f = useFiltersStore();
  const views = useSavedViewsStore((s) => s.views);
  const addView = useSavedViewsStore((s) => s.add);
  const removeView = useSavedViewsStore((s) => s.remove);
  const hydrateViews = useSavedViewsStore((s) => s.hydrate);
  const viewsLoaded = useSavedViewsStore((s) => s.loaded);
  const [savedOpen, setSavedOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!viewsLoaded) hydrateViews();
  }, [viewsLoaded, hydrateViews]);

  function applyView(v: ReturnType<typeof useSavedViewsStore.getState>["views"][number]) {
    if (v.preset === "month" && v.monthYM) {
      f.setMonth(v.monthYM);
    } else {
      f.setPreset(v.preset);
      f.setRange(v.from, v.to);
    }
    f.resetSet("accounts");
    f.resetSet("categories");
    f.resetSet("currencies");
    for (const a of v.accounts) f.toggleSet("accounts", a);
    for (const c of v.categories) f.toggleSet("categories", c);
    for (const c of v.currencies) f.toggleSet("currencies", c);
    f.setSearch(v.search);
    f.setExcludeTransfers(v.excludeTransfers);
    setSavedOpen(false);
  }

  function saveCurrent() {
    if (!newName.trim()) return;
    addView({
      name: newName.trim(),
      preset: f.preset,
      from: f.from,
      to: f.to,
      monthYM: f.monthYM,
      accounts: Array.from(f.accounts),
      categories: Array.from(f.categories),
      currencies: Array.from(f.currencies),
      search: f.search,
      excludeTransfers: f.excludeTransfers,
    });
    setNewName("");
    setSaveOpen(false);
  }

  const accounts = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) if (t.account) set.add(t.account);
    return Array.from(set).sort();
  }, [transactions]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) if (t.category) set.add(t.category);
    return Array.from(set).sort();
  }, [transactions]);

  const currencies = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) if (t.currency) set.add(t.currency);
    return Array.from(set).sort();
  }, [transactions]);

  const dataRange = useMemo(() => {
    let min = "";
    let max = "";
    for (const t of transactions) {
      if (!min || t.date < min) min = t.date;
      if (!max || t.date > max) max = t.date;
    }
    return {
      minYM: min.slice(0, 7) || "",
      maxYM: max.slice(0, 7) || "",
    };
  }, [transactions]);

  const currentMonthYM =
    f.preset === "month" && f.monthYM ? f.monthYM : dataRange.maxYM;
  const canPrev =
    !!dataRange.minYM && currentMonthYM > dataRange.minYM;
  const canNext =
    !!dataRange.maxYM && currentMonthYM < dataRange.maxYM;

  // Default preset is now "current month"; treat anything else as user-set.
  const now = new Date();
  const defaultMonthYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const hasFilters =
    f.accounts.size > 0 ||
    f.categories.size > 0 ||
    f.currencies.size > 0 ||
    f.search.length > 0 ||
    !(f.preset === "month" && f.monthYM === defaultMonthYM);

  if (transactions.length === 0) return null;

  return (
    <div className="card p-3 md:card-pad md:p-5 mb-4 md:mb-6">
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <div className="flex items-center gap-2 mr-2">
          <Filter className="w-4 h-4 text-muted" />
          <span className="text-sm font-medium">Фильтры</span>
        </div>

        <div className="relative">
          <button
            onClick={() => setSavedOpen((o) => !o)}
            className={clsx(
              "btn-ghost text-xs",
              views.length > 0 && "border-accent2 text-accent2"
            )}
            title="Сохранённые виды"
          >
            <Bookmark className="w-3.5 h-3.5" />
            Виды {views.length > 0 && `(${views.length})`}
          </button>
          {savedOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setSavedOpen(false)} />
              <div className="absolute z-20 mt-1 w-72 max-h-80 overflow-auto card p-2 left-0">
                <div className="text-xs text-muted px-2 py-1 mb-1">
                  {views.length === 0 ? "Нет сохранённых видов" : "Применить вид"}
                </div>
                {views.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center gap-1 hover:bg-panel2 rounded group"
                  >
                    <button
                      onClick={() => applyView(v)}
                      className="flex-1 text-left text-sm px-2 py-1.5 truncate"
                      title={v.name}
                    >
                      <Bookmark className="w-3 h-3 inline mr-1.5 text-accent2" />
                      {v.name}
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        const ok = await confirm({
                          title: "Удалить сохранённый вид?",
                          message: `«${v.name}» будет удалён из списка.`,
                          confirmLabel: "Удалить",
                          tone: "danger",
                        });
                        if (ok) removeView(v.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-muted hover:text-expense"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => setSaveOpen((o) => !o)}
            className="btn-ghost text-xs"
            title="Сохранить текущие фильтры"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            Сохранить
          </button>
          {saveOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setSaveOpen(false)} />
              <div className="absolute z-20 mt-1 w-64 card p-3 left-0">
                <div className="label mb-1">Имя вида</div>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveCurrent()}
                  placeholder="Например: Еда за 2026"
                  className="input text-sm mb-2"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button onClick={saveCurrent} className="btn-primary text-xs flex-1">
                    Сохранить
                  </button>
                  <button onClick={() => setSaveOpen(false)} className="btn-ghost text-xs">
                    Отмена
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex bg-panel2 rounded-lg p-1 border border-border">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => f.setPreset(p.value)}
              className={clsx(
                "px-3 py-1 text-xs rounded-md transition-colors",
                f.preset === p.value
                  ? "bg-accent text-accent-fg font-medium"
                  : "text-muted hover:text-text"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div
          className={clsx(
            "flex items-center bg-panel2 rounded-lg p-1 border",
            f.preset === "month" ? "border-accent" : "border-border"
          )}
          title="Перейти к одному месяцу"
        >
          <button
            onClick={() => f.stepMonth(-1, dataRange.maxYM)}
            disabled={!canPrev}
            className="p-1 rounded hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed"
            title="Предыдущий месяц"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => f.setMonth(currentMonthYM)}
            className={clsx(
              "px-2 py-1 text-xs rounded-md flex items-center gap-1.5 transition-colors min-w-[110px] justify-center",
              f.preset === "month"
                ? "bg-accent text-accent-fg font-medium"
                : "text-muted hover:text-text"
            )}
          >
            <CalendarRange className="w-3 h-3" />
            {currentMonthYM ? monthLabel(currentMonthYM) : "Месяц"}
          </button>
          <button
            onClick={() => f.stepMonth(1, dataRange.maxYM)}
            disabled={!canNext}
            className="p-1 rounded hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed"
            title="Следующий месяц"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={f.from || ""}
            onChange={(e) => f.setRange(e.target.value || null, f.to)}
            className="input text-xs py-1.5 w-36"
          />
          <span className="text-muted">—</span>
          <input
            type="date"
            value={f.to || ""}
            onChange={(e) => f.setRange(f.from, e.target.value || null)}
            className="input text-xs py-1.5 w-36"
          />
        </div>

        <MultiSelect
          label="Счета"
          options={accounts}
          selected={f.accounts}
          onToggle={(v) => f.toggleSet("accounts", v)}
          onReset={() => f.resetSet("accounts")}
        />

        <MultiSelect
          label="Категории"
          options={categories}
          selected={f.categories}
          onToggle={(v) => f.toggleSet("categories", v)}
          onReset={() => f.resetSet("categories")}
        />

        {currencies.length > 1 && (
          <MultiSelect
            label="Валюта"
            options={currencies}
            selected={f.currencies}
            onToggle={(v) => f.toggleSet("currencies", v)}
            onReset={() => f.resetSet("currencies")}
          />
        )}

        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            value={f.search}
            onChange={(e) => f.setSearch(e.target.value)}
            placeholder="Поиск по получателю/комментарию"
            className="input pl-9 pr-9 text-sm"
          />
          {f.search && (
            <button
              onClick={() => f.setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {hasFilters && (
          <button
            onClick={f.reset}
            className="text-xs text-muted hover:text-accent underline"
          >
            Сбросить всё
          </button>
        )}

        <label className="flex items-center gap-2 ml-auto text-xs text-muted">
          <input
            type="checkbox"
            checked={f.excludeTransfers}
            onChange={(e) => f.setExcludeTransfers(e.target.checked)}
            className="accent-accent"
          />
          без переводов
        </label>
      </div>
    </div>
  );
}
