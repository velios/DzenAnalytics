import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Global keyboard shortcuts: ⌘/Ctrl+K and `/` open the palette; `g` followed
 * by a single key (within 1.5s) navigates to a known route.
 *
 * Lives in its own file (not in CommandPalette.tsx) so the component file
 * exports only React components — required for Vite/React fast-refresh.
 */
export function useGlobalShortcuts(onOpenPalette: () => void) {
  const nav = useNavigate();

  useEffect(() => {
    let lastG = 0;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;

      const isCtrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
      if (isCtrlK) {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      if (isInput) return;

      if (e.key === "/") {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      const now = Date.now();
      if (e.key === "g") {
        lastG = now;
        return;
      }
      if (lastG && now - lastG < 1500) {
        const k = e.key.toLowerCase();
        const map: Record<string, string> = {
          d: "/",
          c: "/cashflow",
          k: "/categories",
          a: "/accounts",
          t: "/trends",
          b: "/budgets",
          g: "/goals",
          l: "/calendar",
          r: "/recurring",
          s: "/search",
          h: "/help",
          i: "/import",
          o: "/transactions",
        };
        if (map[k]) {
          e.preventDefault();
          nav(map[k]);
          lastG = 0;
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, onOpenPalette]);
}
