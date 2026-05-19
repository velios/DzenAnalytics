import type { ReactNode } from "react";

/**
 * Mini section divider used inside long pages (Settings, Help, Goals…)
 * to group related cards under a typographic header.
 *
 * Was previously inlined as a local helper in ImportPage; promoted to
 * a shared component so the look stays consistent everywhere we group
 * cards under a heading.
 *
 * Render it between cards inside a `space-y-6` flow — the natural
 * spacing of the parent takes care of vertical rhythm.
 */
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wider text-muted px-1 pt-2">
      {children}
    </h2>
  );
}
