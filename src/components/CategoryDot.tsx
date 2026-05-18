import { useEffect } from "react";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { zenIconToEmoji } from "../lib/zenIconEmoji";

interface Props {
  category: string;
  /** Tailwind size for the round wrapper. Default w-5 h-5. */
  size?: string;
  /** Fallback colour when the category has no meta — defaults to muted. */
  fallback?: string | null;
  /** Hide the dot/badge entirely when there is no colour AND no icon. */
  hideEmpty?: boolean;
}

/**
 * Small coloured badge next to a category label. When the Zenmoney sync has
 * populated `categoryMeta` (icon + colour from the API tag), it renders a
 * coloured circle with the emoji glyph for the icon. With colour only — a
 * plain coloured disc. With nothing — null (or a muted fallback dot).
 */
export function CategoryDot({
  category,
  size = "w-5 h-5",
  fallback = null,
  hideEmpty = false,
}: Props) {
  const meta = useCategoryMetaStore((s) => s.meta[category]);
  const loaded = useCategoryMetaStore((s) => s.loaded);
  const hydrate = useCategoryMetaStore((s) => s.hydrate);
  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);

  const color = meta?.color ?? fallback;
  const emoji = zenIconToEmoji(meta?.icon);

  if (!color && !emoji) {
    return hideEmpty ? null : null;
  }

  // With an icon → coloured circle + emoji inside. Without an icon → just a
  // small coloured dot. Emoji-only (no colour) is uncommon but rendered too.
  if (emoji) {
    return (
      <span
        aria-hidden
        className={`inline-flex items-center justify-center rounded-full shrink-0 text-[11px] leading-none ${size}`}
        style={{ background: color || "rgb(148, 163, 184)" }}
      >
        <span className="drop-shadow-sm">{emoji}</span>
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={`inline-block rounded-full shrink-0 ${size}`}
      style={{ background: color! }}
    />
  );
}
