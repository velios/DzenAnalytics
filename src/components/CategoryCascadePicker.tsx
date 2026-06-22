import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { CategoryDot } from "./CategoryDot";

export interface CategoryNode {
  name: string;
  /** Sub-category titles, already sorted. Empty → leaf category. */
  subs: string[];
}

interface Props {
  category: string;
  /** "" = no sub-category. */
  subcategory: string;
  categories: CategoryNode[];
  onChange: (category: string, subcategory: string) => void;
  placeholder?: string;
  maxHeight?: string;
}

/**
 * Single full-width category field with a two-column dropdown: parent
 * categories on the left, the active parent's sub-categories on the right.
 * Picking a leaf category (no subs) commits immediately; clicking a category
 * that HAS sub-categories toggles them open/closed on the right (explicit
 * click, no hover), where «Без подкатегории» picks the parent alone. This keeps
 * the first level to real top-level categories only and makes a category +
 * sub-category an unambiguous single choice (see issue #12).
 */
export function CategoryCascadePicker({
  category,
  subcategory,
  categories,
  onChange,
  placeholder = "Выберите категорию",
  maxHeight = "min(46vh, 280px)",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Which parent's sub-categories are shown on the right.
  const [activeParent, setActiveParent] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return categories;
    return categories.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.subs.some((s) => s.toLowerCase().includes(q))
    );
  }, [categories, q]);

  const active = useMemo(
    () => categories.find((c) => c.name === activeParent) ?? null,
    [categories, activeParent]
  );
  const activeSubs = useMemo(() => {
    if (!active) return [];
    // If the query matched the parent name, show all its subs; otherwise narrow
    // to subs that match so search inside a big category still works.
    if (!q || active.name.toLowerCase().includes(q)) return active.subs;
    return active.subs.filter((s) => s.toLowerCase().includes(q));
  }, [active, q]);

  // While searching, collapse the cascade into ONE flat, directly-selectable
  // list of matching leaves — both categories and sub-categories — so a
  // sub-category can be picked in a single click instead of drilling in
  // (issue #21). Null when not searching (then the two-column cascade shows).
  type SearchLeaf =
    | { kind: "cat"; cat: string }
    | { kind: "sub"; cat: string; sub: string };
  const searchLeaves = useMemo<SearchLeaf[] | null>(() => {
    if (!q) return null;
    const items: SearchLeaf[] = [];
    for (const c of categories) {
      if (c.name.toLowerCase().includes(q)) items.push({ kind: "cat", cat: c.name });
      for (const s of c.subs) {
        if (s.toLowerCase().includes(q)) items.push({ kind: "sub", cat: c.name, sub: s });
      }
    }
    return items;
  }, [categories, q]);

  function toggle() {
    if (!open) {
      setQuery("");
      setActiveParent(category || null);
    }
    setOpen((o) => !o);
  }

  function commit(cat: string, sub: string) {
    onChange(cat, sub);
    setOpen(false);
    setQuery("");
  }

  const label = category
    ? subcategory
      ? `${category} / ${subcategory}`
      : category
    : "";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        className="input text-sm w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          {category && <CategoryDot category={category} size="w-5 h-5" />}
          <span className={`truncate ${label ? "" : "text-muted"}`}>
            {label || placeholder}
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full bg-panel border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border">
            <Search className="w-3.5 h-3.5 text-muted shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск категории"
              className="bg-transparent text-sm w-full outline-none"
            />
          </div>
          {searchLeaves ? (
            /* Search mode — one flat list with directly-selectable leaves,
               sub-categories included (issue #21). */
            <div className="overflow-y-auto" style={{ maxHeight }}>
              {searchLeaves.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted">Ничего не найдено</div>
              ) : (
                searchLeaves.map((it) =>
                  it.kind === "cat" ? (
                    <button
                      key={`c:${it.cat}`}
                      type="button"
                      onClick={() => commit(it.cat, "")}
                      className={`w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2 hover:bg-panel2 ${
                        category === it.cat && !subcategory ? "text-accent" : ""
                      }`}
                    >
                      <CategoryDot category={it.cat} size="w-4 h-4" />
                      <span className="truncate">{it.cat}</span>
                    </button>
                  ) : (
                    <button
                      key={`s:${it.cat}/${it.sub}`}
                      type="button"
                      onClick={() => commit(it.cat, it.sub)}
                      className={`w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2 hover:bg-panel2 ${
                        category === it.cat && subcategory === it.sub ? "text-accent" : ""
                      }`}
                    >
                      <CategoryDot category={it.sub} parent={it.cat} size="w-4 h-4" />
                      <span className="truncate flex-1">{it.sub}</span>
                      <span className="text-[11px] text-muted truncate shrink-0 max-w-[45%]">
                        {it.cat}
                      </span>
                    </button>
                  )
                )
              )}
            </div>
          ) : (
          <div className="flex" style={{ maxHeight }}>
            {/* Left — top-level categories */}
            <div className="w-1/2 overflow-y-auto border-r border-border/60">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted">Ничего не найдено</div>
              ) : (
                filtered.map((c) => {
                  const isSel = c.name === category;
                  const isActive = c.name === activeParent;
                  const hasSubs = c.subs.length > 0;
                  return (
                    <button
                      key={c.name}
                      type="button"
                      // A category WITH sub-categories toggles them open/closed
                      // on click (explicit — no hover); a leaf category commits.
                      onClick={() =>
                        hasSubs
                          ? setActiveParent(isActive ? null : c.name)
                          : commit(c.name, "")
                      }
                      aria-expanded={hasSubs ? isActive : undefined}
                      className={`w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2 hover:bg-panel2 ${
                        isActive ? "bg-panel2" : ""
                      } ${isSel ? "text-accent" : ""}`}
                    >
                      <CategoryDot category={c.name} size="w-4 h-4" />
                      <span className="truncate flex-1">{c.name}</span>
                      {hasSubs &&
                        (isActive ? (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted" />
                        ))}
                    </button>
                  );
                })
              )}
            </div>
            {/* Right — sub-categories of the active parent */}
            <div className="w-1/2 overflow-y-auto">
              {active && active.subs.length > 0 ? (
                <>
                  {/* Pick the parent category itself (no sub-category). */}
                  <button
                    type="button"
                    onClick={() => commit(active.name, "")}
                    className={`w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2 hover:bg-panel2 ${
                      category === active.name && !subcategory ? "text-accent" : "text-muted"
                    }`}
                  >
                    <CategoryDot category={active.name} size="w-4 h-4" />
                    <span className="truncate">Без подкатегории</span>
                  </button>
                  {activeSubs.map((s) => {
                    const isSel = category === active.name && subcategory === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => commit(active.name, s)}
                        className={`w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2 hover:bg-panel2 ${
                          isSel ? "text-accent" : ""
                        }`}
                      >
                        <CategoryDot category={s} parent={active.name} size="w-4 h-4" />
                        <span className="truncate">{s}</span>
                      </button>
                    );
                  })}
                </>
              ) : (
                <div className="px-3 py-2 text-xs text-muted">
                  {active ? "Нет подкатегорий" : "Выберите категорию"}
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
