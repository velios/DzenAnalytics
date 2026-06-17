import { Sun, Moon } from "lucide-react";
import { useThemeStore } from "../store/useThemeStore";

/**
 * Compact pill toggle: sun (light) on the left, moon (dark) on the right,
 * with a sliding thumb. Click anywhere to flip between modes.
 *
 * The store still supports an "auto" mode internally, but it's rarely used
 * and would complicate a binary UI. Toggling here explicitly picks "light"
 * or "dark" — if a user genuinely wants OS-follow they can set it via
 * the command palette / DevTools (`useThemeStore.getState().setMode("auto")`).
 */
export function ThemeSwitcher() {
  const resolved = useThemeStore((s) => s.resolved);
  const setMode = useThemeStore((s) => s.setMode);
  const isDark = resolved === "dark";

  return (
    <button
      type="button"
      onClick={() => setMode(isDark ? "light" : "dark")}
      title={isDark ? "Тёмная → светлая" : "Светлая → тёмная"}
      aria-label={`Тема: ${isDark ? "тёмная" : "светлая"}`}
      className="relative inline-flex items-center w-[52px] h-7 shrink-0 rounded-full bg-panel2 border border-border transition-colors hover:border-accent/50"
    >
      {/* Sliding thumb. `top-px` (1px) centres it vertically in the 26px inner
          box (was top-0.5 = 2px, which left it flush with the bottom and
          looked low). translateX(22px) lands the thumb centre exactly on each
          icon (symmetric 3px gaps), so the moon sits centred in dark mode. */}
      <span
        className="absolute top-px left-0.5 w-6 h-6 rounded-full bg-bg shadow border border-border transition-transform duration-200 ease-out"
        style={{ transform: isDark ? "translateX(22px)" : "translateX(0)" }}
      />
      {/* Sun (left) */}
      <Sun
        className={`absolute left-1.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-opacity ${
          isDark ? "opacity-40 text-muted" : "opacity-100 text-warn"
        }`}
      />
      {/* Moon (right) */}
      <Moon
        className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-opacity ${
          isDark ? "opacity-100 text-accent" : "opacity-40 text-muted"
        }`}
      />
    </button>
  );
}
