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
  { to: "/compare", label: "Сравнение", icon: GitCompare },
  { to: "/top", label: "Топ", icon: TrendingUp },
  { to: "/import", label: "Импорт", icon: Upload },
];

export function TopNav() {
  const txCount = useDataStore((s) => s.transactions.length);
  const meta = useDataStore((s) => s.importMeta);
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  const inSecondary = SECONDARY.some((s) => loc.pathname === s.to);

  return (
    <header className="border-b border-border bg-panel/80 backdrop-blur sticky top-0 z-30">
      <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-white font-bold">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-none">DzenAnalytics</div>
            <div className="text-[10px] text-muted leading-none mt-0.5">
              {txCount > 0
                ? `${formatNum(txCount)} операций${meta ? ` · ${new Date(meta.importedAt).toLocaleDateString("ru-RU")}` : ""}`
                : "Аналитика финансов"}
            </div>
          </div>
        </div>

        <nav className="flex items-center gap-1 ml-4 flex-1">
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
              onClick={() => setOpen((o) => !o)}
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
            {open && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                <div className="absolute z-20 mt-1 w-52 card p-1.5 left-0">
                  {SECONDARY.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      onClick={() => setOpen(false)}
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

        <NavLink
          to="/search"
          className={({ isActive }) =>
            clsx(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors border",
              isActive
                ? "bg-accent/10 text-accent border-accent/40"
                : "bg-panel2 text-muted hover:text-text border-border"
            )
          }
          title="Глобальный поиск"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Поиск</span>
        </NavLink>

        <ThemeSwitcher />
      </div>
    </header>
  );
}
