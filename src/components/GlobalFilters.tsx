import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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
  Coins,
} from "lucide-react";
import { DateField } from "./DateField";
import { AccountLogo } from "./AccountLogo";
import { CategoryFilterPicker } from "./CategoryFilterPicker";
import clsx from "clsx";
import { useDataStore } from "../store/useDataStore";
import { getLiveAccountsFromCache } from "../store/useZenmoneyStore";
import { useFiltersStore, FILTER_NONE, type DatePreset } from "../store/useFiltersStore";
import { useSavedViewsStore } from "../store/useSavedViewsStore";
import { confirm } from "../store/useConfirmStore";
import { monthLabel } from "../lib/format";
import { NO_CATEGORY } from "../lib/zenmoneyMap";
import { currencyFlagEmoji } from "../lib/currencyFlag";
import { pluralRu } from "../lib/plural";

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
  onChange,
  renderIcon,
  unitForms,
  searchPlaceholder,
  archivedSet,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Optional leading icon per option (e.g. account logo / category dot). */
  renderIcon?: (opt: string) => ReactNode;
  /** Russian [one, few, many] noun for the count header (e.g. счёт/счёта/счетов). */
  unitForms?: [string, string, string];
  /** Override the search placeholder. */
  searchPlaceholder?: string;
  /** Options in this set are «archived» — rendered below an «Архивные»
   *  divider (the caller must place them last in `options`). */
  archivedSet?: Set<string>;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Search appears only for longer lists (currency etc. don't need it).
  const showSearch = options.length > 8;
  const q = query.trim().toLowerCase();
  const filteredOptions = q
    ? options.filter((o) => o.toLowerCase().includes(q))
    : options;

  // Set semantics: empty = ALL, {FILTER_NONE} = NONE, else a subset.
  const isAll = selected.size === 0;
  const isNone = selected.has(FILTER_NONE);
  const isChecked = (opt: string) => isAll || (!isNone && selected.has(opt));

  // Toggle one option, normalising the result back to the canonical empty
  // set (all) or the {FILTER_NONE} marker (none).
  const toggle = (opt: string) => {
    const eff = isNone
      ? new Set<string>()
      : isAll
        ? new Set(options)
        : new Set(selected);
    eff.delete(FILTER_NONE);
    if (eff.has(opt)) eff.delete(opt);
    else eff.add(opt);
    if (eff.size >= options.length) onChange(new Set()); // all → empty
    else if (eff.size === 0) onChange(new Set([FILTER_NONE])); // none
    else onChange(eff);
  };

  const summary = isNone
    ? "Ничего"
    : isAll
      ? `Все (${options.length})`
      : selected.size === 1
        ? Array.from(selected)[0]
        : `Выбрано ${selected.size} из ${options.length}`;

  // The menu renders in a portal (position: fixed) so it floats above the
  // table below — `absolute` left it under a later stacking context. Its
  // left edge lines up with the button; it flips up if there's more room
  // above (and the menu fits there).
  type MenuPos = {
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  };
  const [pos, setPos] = useState<MenuPos | null>(null);
  const MENU_W = 288;

  useLayoutEffect(() => {
    const el = btnRef.current;
    let next: MenuPos | null = null;
    if (open && el) {
      const r = el.getBoundingClientRect();
      const width = Math.max(r.width, MENU_W);
      const estH = Math.min(options.length * 32 + 44 + (showSearch ? 40 : 0), 360);
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const flipUp = above > below && above >= Math.min(estH, 48);
      next = flipUp
        ? {
            left: r.left,
            width,
            bottom: window.innerHeight - r.top + 4,
            maxHeight: Math.min(estH, above),
          }
        : {
            left: r.left,
            width,
            top: r.bottom + 4,
            maxHeight: Math.min(estH, below),
          };
    }
    setPos(next);
  }, [open, options.length, showSearch]);

  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      const t = e.target;
      if (menuRef.current && t instanceof Node && menuRef.current.contains(t)) {
        return;
      }
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
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
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
            <div
              ref={menuRef}
              className="fixed z-[80] overflow-auto card p-2"
              style={{
                left: pos.left,
                width: pos.width,
                top: pos.top,
                bottom: pos.bottom,
                maxHeight: pos.maxHeight,
              }}
            >
              <div className="flex items-center justify-between gap-2 px-2 py-1 mb-1 border-b border-border/60">
                <span className="text-xs text-muted">
                  {options.length}{" "}
                  {pluralRu(
                    options.length,
                    unitForms ?? ["вариант", "варианта", "вариантов"]
                  )}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onChange(new Set())}
                    disabled={isAll}
                    className="text-xs text-accent hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    Выбрать все
                  </button>
                  <button
                    onClick={() => onChange(new Set([FILTER_NONE]))}
                    disabled={isNone}
                    className="text-xs text-accent hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    Снять все
                  </button>
                </div>
              </div>
              {showSearch && (
                <div className="flex items-center gap-2 px-2 py-1.5 mb-1 border-b border-border/60">
                  <Search className="w-3.5 h-3.5 text-muted shrink-0" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={searchPlaceholder ?? `Поиск: ${label.toLowerCase()}`}
                    className="bg-transparent text-sm w-full outline-none"
                  />
                </div>
              )}
              {filteredOptions.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted">Ничего не найдено</div>
              ) : (
                filteredOptions.map((opt, i) => {
                  // First archived option → render an «Архивные» divider above it.
                  const showArchivedHeader =
                    !!archivedSet?.has(opt) &&
                    (i === 0 || !archivedSet.has(filteredOptions[i - 1]));
                  return (
                    <Fragment key={opt}>
                      {showArchivedHeader && (
                        <div className="mt-1 pt-1 border-t border-border px-2 pb-0.5 text-[11px] uppercase tracking-wide text-muted">
                          Архивные
                        </div>
                      )}
                      <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-panel2 rounded cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={isChecked(opt)}
                          onChange={() => toggle(opt)}
                          className="accent-accent shrink-0"
                        />
                        {renderIcon && (
                          <span className="shrink-0">{renderIcon(opt)}</span>
                        )}
                        <span className="truncate">{opt}</span>
                      </label>
                    </Fragment>
                  );
                })
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

export function GlobalFilters({
  showDateRange = true,
}: { showDateRange?: boolean } = {}) {
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

  // Archived (closed) account titles from the Zenmoney cache — used to sort the
  // archived accounts to the bottom of the filter and group them under a divider.
  const [archivedAccounts, setArchivedAccounts] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    getLiveAccountsFromCache().then((live) => {
      if (cancelled || !live) return;
      setArchivedAccounts(new Set(live.filter((a) => a.archive).map((a) => a.title)));
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);

  const accounts = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) if (t.account) set.add(t.account);
    // Active accounts first (alpha), archived grouped at the bottom (alpha).
    return Array.from(set).sort((a, b) => {
      const aa = archivedAccounts.has(a);
      const ba = archivedAccounts.has(b);
      if (aa !== ba) return aa ? 1 : -1;
      return a.localeCompare(b, "ru");
    });
  }, [transactions, archivedAccounts]);

  // Parent categories each with their observed sub-categories — for the cascade
  // category filter (parent on the left, subs on the right).
  const categoryNodes = useMemo(() => {
    const map = new Map<string, { subs: Set<string>; hasBare: boolean }>();
    for (const t of transactions) {
      if (!t.category) continue;
      let e = map.get(t.category);
      if (!e) {
        e = { subs: new Set<string>(), hasBare: false };
        map.set(t.category, e);
      }
      // A transaction tagged with just the parent (no sub) is "bare" — a
      // distinct leaf from any «Category / Subcategory».
      if (t.subcategory) e.subs.add(t.subcategory);
      else e.hasBare = true;
    }
    const real = [...map.entries()]
      .filter(([name]) => name !== NO_CATEGORY)
      .map(([name, e]) => ({
        name,
        hasBare: e.hasBare,
        subs: [...e.subs].sort((a, b) => a.localeCompare(b, "ru")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
    // Pin «Без категории» first (mirrors the edit-modal picker) so the
    // uncategorized leaf is always an obvious, selectable filter — handy for
    // hunting down operations that still need a category.
    return [{ name: NO_CATEGORY, hasBare: true, subs: [] }, ...real];
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

        {showDateRange && (
        <>
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
          <DateField
            value={f.from || ""}
            onChange={(e) => f.setRange(e.target.value || null, f.to)}
            className="input text-xs py-1.5"
            wrapperClassName="w-36"
          />
          <span className="text-muted">—</span>
          <DateField
            value={f.to || ""}
            onChange={(e) => f.setRange(f.from, e.target.value || null)}
            className="input text-xs py-1.5"
            wrapperClassName="w-36"
          />
        </div>
        </>
        )}

        <MultiSelect
          label="Счета"
          options={accounts}
          selected={f.accounts}
          onChange={(s) => f.setSet("accounts", s)}
          renderIcon={(name) => <AccountLogo title={name} size={18} />}
          unitForms={["счёт", "счёта", "счетов"]}
          searchPlaceholder="Поиск счёта"
          archivedSet={archivedAccounts}
        />

        <CategoryFilterPicker
          nodes={categoryNodes}
          selected={f.categories}
          onChange={(s) => f.setSet("categories", s)}
        />

        {currencies.length > 1 && (
          <MultiSelect
            label="Валюта"
            options={currencies}
            selected={f.currencies}
            onChange={(s) => f.setSet("currencies", s)}
            unitForms={["валюта", "валюты", "валют"]}
            renderIcon={(code) => {
              const flag = currencyFlagEmoji(code);
              return flag ? (
                <span className="text-base leading-none">{flag}</span>
              ) : (
                <Coins className="w-4 h-4 text-muted" />
              );
            }}
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
          Без переводов
        </label>
      </div>
    </div>
  );
}
