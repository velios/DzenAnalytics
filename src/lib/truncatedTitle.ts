// Native `title` tooltips on truncated table cells pop up even when the text
// fits — annoying noise. This delegated handler keeps the tooltip ONLY when
// the cell is actually clipped (scroll size > client size) and non-empty.
//
// Scoped to cells that opt into truncation via a `truncate` or `line-clamp-*`
// class, so real tooltips on buttons / icons (which don't truncate) are never
// touched. Install once at app start.

const STASH = "data-full-title";

function isTruncationCell(el: Element): el is HTMLElement {
  const c = (el as HTMLElement).className;
  return typeof c === "string" && (/\btruncate\b/.test(c) || c.includes("line-clamp"));
}

function isClipped(el: HTMLElement): boolean {
  // +1 absorbs sub-pixel rounding. Width for single-line `truncate`,
  // height for multi-line `line-clamp`.
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

function onOver(e: Event): void {
  const target = e.target as Element | null;
  const el = target?.closest?.(`[title], [${STASH}]`);
  if (!el || !isTruncationCell(el)) return;
  // Source of truth survives React re-renders re-adding `title`.
  const real = el.getAttribute(STASH) ?? el.getAttribute("title");
  if (real == null) return;
  const hasText = (el.textContent || "").trim().length > 0;
  if (hasText && isClipped(el)) {
    if (el.getAttribute("title") == null) el.setAttribute("title", real);
    el.removeAttribute(STASH);
  } else {
    if (el.getAttribute("title") != null) el.removeAttribute("title");
    el.setAttribute(STASH, real);
  }
}

function onOut(e: Event): void {
  const target = e.target as Element | null;
  const el = target?.closest?.(`[${STASH}]`);
  if (!el) return;
  const saved = el.getAttribute(STASH);
  if (saved != null) {
    // Restore so the DOM keeps the title when not hovering (a11y / consistency).
    el.setAttribute("title", saved);
    el.removeAttribute(STASH);
  }
}

export function installTruncatedTitles(): () => void {
  document.addEventListener("mouseover", onOver, true);
  document.addEventListener("mouseout", onOut, true);
  return () => {
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("mouseout", onOut, true);
  };
}
