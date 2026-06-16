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
 * categories on the left, the hovered/selected parent's sub-categories on the
 * right. Picking a leaf category (no subs) commits immediately; a category with
 * subs opens them to the right, where «Без подкатегории» picks the parent
 * alone. This keeps the first level to real top-level categories only and makes
 * a category + sub-category an unambiguous single choice (see issue #12).
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
          <div className="flex" style={{ maxHeight }}>
            {/* Left — top-level categories */}
            <div className="w-1/2 overflow-y-auto border-r border-border/60">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted">Ничего не найдено</div>
              ) : (
                filtered.map((c) => {
                  const isSel = c.name === category;
                  const isActive = c.name === activeParent;
                  return (
                    <div
                      key={c.name}
                      onMouseEnter={() => c.subs.length > 0 && setActiveParent(c.name)}
                      className={`flex items-center ${isActive ? "bg-panel2" : ""}`}
                    >
                      {/* Click the category itself to pick it (no sub-category). */}
                      <button
                        type="button"
                        onClick={() => commit(c.name, "")}
                        className={`flex-1 min-w-0 text-left px-2.5 py-1.5 text-sm flex items-center gap-2 hover:bg-panel2 ${
                          isSel ? "text-accent" : ""
                        }`}
                      >
                        <CategoryDot category={c.name} size="w-4 h-4" />
                        <span className="truncate">{c.name}</span>
                      </button>
                      {/* Separate target opens sub-categories without committing
                          (so touch users, who can't hover, can still reach them). */}
                      {c.subs.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setActiveParent(c.name)}
                          aria-label={`Подкатегории: ${c.name}`}
                          className="px-1.5 py-1.5 shrink-0 text-muted hover:text-text hover:bg-panel2"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {/* Right — sub-categories of the active parent */}
            <div className="w-1/2 overflow-y-auto">
              {active && active.subs.length > 0 ? (
                <>
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
        </div>
      )}
    </div>
  );
}
