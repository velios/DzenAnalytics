import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  BarChart3,
  PieChart,
  Wallet,
  TrendingUp,
  GitCompare,
  Upload,
  LineChart,
  CalendarDays,
  Hash,
  Repeat,
  MoreHorizontal,
  LayoutDashboard,
  Activity,
  Target,
  Zap,
  Search,
  Copy,
  Tag,
  GitFork,
  Bookmark,
  Wand2,
  HelpCircle,
  Cloud,
  HeartPulse,
  FlaskConical,
  Sparkles,
  Newspaper,
  Menu,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useDataStore } from "../store/useDataStore";
import { formatNum } from "../lib/format";
import { ThemeSwitcher } from "./ThemeSwitcher";

const PRIMARY = [
  { to: "/", label: "Главная", icon: LayoutDashboard },
  { to: "/cashflow", label: "Cash-flow", icon: LineChart },
  { to: "/categories", label: "Категории", icon: PieChart },
  { to: "/trends", label: "Тренды", icon: Activity },
  { to: "/goals", label: "Цели", icon: Target },
];

const SECONDARY = [
  { to: "/health", label: "Здоровье", icon: HeartPulse },
  { to: "/whatif", label: "What-if", icon: FlaskConical },
  { to: "/year-review", label: "Год в цифрах", icon: Sparkles },
  { to: "/digest", label: "Дайджест", icon: Newspaper },
  { to: "/budgets", label: "Бюджеты", icon: Target },
  { to: "/accounts", label: "Счета", icon: Wallet },
  { to: "/calendar", label: "Календарь", icon: CalendarDays },
  { to: "/sankey", label: "Потоки", icon: GitFork },
  { to: "/anomalies", label: "Аномалии", icon: Zap },
  { to: "/duplicates", label: "Дубликаты", icon: Copy },
  { to: "/uncategorized", label: "Без категории", icon: Tag },
  { to: "/recurring", label: "Регулярные", icon: Repeat },
  { to: "/annotations", label: "Аннотации", icon: Bookmark },
  { to: "/tags", label: "Хэштеги", icon: Hash },
  { to: "/wordcloud", label: "Облако слов", icon: Cloud },
  { to: "/compare", label: "Сравнение", icon: GitCompare },
  { to: "/top", label: "Топ", icon: TrendingUp },
  { to: "/rules", label: "Правила", icon: Wand2 },
  { to: "/help", label: "Справка", icon: HelpCircle },
  { to: "/import", label: "Импорт", icon: Upload },
];

export function TopNav({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const txCount = useDataStore((s) => s.transactions.length);
  const meta = useDataStore((s) => s.importMeta);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();

  const inSecondary = SECONDARY.some((s) => loc.pathname === s.to);

  return (
    <header className="border-b border-border bg-panel/80 backdrop-blur sticky top-0 z-30">
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-3 flex items-center gap-3 md:gap-6">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-white font-bold">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-semibold leading-none">DzenAnalytics</div>
            <div className="text-[10px] text-muted leading-none mt-0.5">
              {txCount > 0
                ? `${formatNum(txCount)} операций${meta ? ` · ${new Date(meta.importedAt).toLocaleDateString("ru-RU")}` : ""}`
                : "Аналитика финансов"}
            </div>
          </div>
        </div>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-1 ml-2 flex-1">
          {PRIMARY.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive
                    ? "bg-accent/10 text-accent"
                    : "text-muted hover:text-text hover:bg-panel2"
                )
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}

          <div className="relative">
            <button
              onClick={() => setMoreOpen((o) => !o)}
              className={clsx(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                inSecondary
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:text-text hover:bg-panel2"
              )}
            >
              <MoreHorizontal className="w-4 h-4" />
              Ещё
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
                <div className="absolute z-20 mt-1 w-52 card p-1.5 left-0 max-h-[70vh] overflow-y-auto">
                  {SECONDARY.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive }) =>
                        clsx(
                          "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                          isActive
                            ? "bg-accent/10 text-accent"
                            : "text-muted hover:text-text hover:bg-panel2"
                        )
                      }
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </NavLink>
                  ))}
                </div>
              </>
            )}
          </div>
        </nav>

        {/* Spacer on mobile pushes right group to the end */}
        <div className="flex-1 lg:hidden" />

        <button
          onClick={onOpenPalette}
          className="hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs border bg-panel2 text-muted hover:text-text border-border"
          title="Командная палитра (Ctrl+K)"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Команды…</span>
          <kbd className="kbd hidden lg:inline-block">⌘K</kbd>
        </button>
        <button
          onClick={onOpenPalette}
          className="md:hidden p-1.5 rounded-lg border border-border bg-panel2 text-muted"
          title="Командная палитра"
        >
          <Search className="w-4 h-4" />
        </button>

        <ThemeSwitcher />

        {/* Mobile burger */}
        <button
          onClick={() => setMobileOpen(true)}
          className="lg:hidden p-1.5 rounded-lg border border-border bg-panel2 text-muted"
          title="Меню"
        >
          <Menu className="w-4 h-4" />
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute right-0 top-0 bottom-0 w-[80vw] max-w-[320px] bg-bg border-l border-border flex flex-col animate-slide">
            <div className="px-4 py-4 border-b border-border flex items-center justify-between">
              <span className="font-semibold">Меню</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1.5 text-muted hover:text-text"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted px-4 pt-2 pb-1">
                Основное
              </div>
              {PRIMARY.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-3 px-4 py-2.5 text-sm",
                      isActive
                        ? "bg-accent/10 text-accent"
                        : "text-muted hover:text-text hover:bg-panel2"
                    )
                  }
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </NavLink>
              ))}
              <div className="text-[10px] uppercase tracking-wider text-muted px-4 pt-3 pb-1">
                Ещё
              </div>
              {SECONDARY.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-3 px-4 py-2.5 text-sm",
                      isActive
                        ? "bg-accent/10 text-accent"
                        : "text-muted hover:text-text hover:bg-panel2"
                    )
                  }
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </NavLink>
              ))}
            </nav>
          </aside>
        </div>
      )}
    </header>
  );
}
