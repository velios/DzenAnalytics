import { Sun, Moon, Monitor } from "lucide-react";
import clsx from "clsx";
import { useThemeStore, type ThemeMode } from "../store/useThemeStore";

const items: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: "light", label: "Светлая", icon: Sun },
  { mode: "dark", label: "Тёмная", icon: Moon },
  { mode: "auto", label: "Авто", icon: Monitor },
];

export function ThemeSwitcher() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const resolved = useThemeStore((s) => s.resolved);

  return (
    <div className="flex bg-panel2 border border-border rounded-lg p-0.5">
      {items.map(({ mode: m, label, icon: Icon }) => {
        const active = mode === m;
        return (
          <button
            key={m}
            onClick={() => setMode(m)}
            title={
              m === "auto"
                ? `Авто (сейчас ${resolved === "dark" ? "тёмная" : "светлая"})`
                : label
            }
            className={clsx(
              "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors",
              active ? "bg-accent text-accent-fg" : "text-muted hover:text-text"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
