import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "dzen.theme";

function loadMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {
    // ignore
  }
  return "light";
}

function resolveAuto(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  const h = new Date().getHours();
  return h >= 20 || h < 7 ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.style.colorScheme = resolved;
}

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (m: ThemeMode) => void;
  init: () => () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: loadMode(),
  resolved: "light",
  setMode: (mode) => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore
    }
    const resolved: ResolvedTheme = mode === "auto" ? resolveAuto() : mode;
    applyTheme(resolved);
    set({ mode, resolved });
  },
  init: () => {
    const { mode } = get();
    const resolved: ResolvedTheme = mode === "auto" ? resolveAuto() : mode;
    applyTheme(resolved);
    set({ resolved });

    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (get().mode === "auto") {
        const r = resolveAuto();
        applyTheme(r);
        set({ resolved: r });
      }
    };
    mql?.addEventListener?.("change", onChange);

    const interval = window.setInterval(() => {
      if (get().mode === "auto") {
        const r = resolveAuto();
        if (r !== get().resolved) {
          applyTheme(r);
          set({ resolved: r });
        }
      }
    }, 60_000);

    return () => {
      mql?.removeEventListener?.("change", onChange);
      window.clearInterval(interval);
    };
  },
}));
