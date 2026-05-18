import { useEffect } from "react";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";

interface Props {
  category: string;
  /** Tailwind size override; default w-2 h-2 (≈8 px). */
  className?: string;
  /** Fallback colour when the category has no meta — defaults to muted. */
  fallback?: string | null;
}

/**
 * Small coloured dot next to a category label. Pulls the colour from
 * `useCategoryMetaStore`, which is populated by the Zenmoney sync. If the
 * meta is empty (CSV mode, no sync yet) the dot uses `fallback` or renders
 * nothing when fallback is null.
 */
export function CategoryDot({ category, className = "w-2 h-2", fallback = null }: Props) {
  const color = useCategoryMetaStore((s) => s.meta[category]?.color) ?? fallback;
  const loaded = useCategoryMetaStore((s) => s.loaded);
  const hydrate = useCategoryMetaStore((s) => s.hydrate);
  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);
  if (!color) return null;
  return (
    <span
      aria-hidden
      className={`inline-block rounded-full shrink-0 ${className}`}
      style={{ background: color }}
    />
  );
}
