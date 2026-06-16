import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import clsx from "clsx";
import { FILTER_NONE } from "../store/useFiltersStore";
import { CategoryDot } from "./CategoryDot";

export interface CategoryNode {
  name: string;
  /** Sub-category titles (sorted). */
  subs: string[];
}

/**
 * Cascade MULTI-select for the global category filter: parent categories on the
 * left, the active parent's sub-categories on the right — same shape as the
 * edit-modal picker, but with checkboxes (issue #9).
 *
 * Selection is a set of leaf keys: a bare category name «Еда» or a full
 * «Еда / Кафе» key (matches `Transaction.categoryFull`). Empty set = ALL,
 * `{FILTER_NONE}` = NONE. Picking a parent toggles all its leaves; sub-leaves
 * toggle independently.
 */
export function CategoryFilterPicker({
  nodes,
  selected,
  onChange,
}: {
  nodes: CategoryNode[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeParent, setActiveParent] = useState<string | null>(null);

  const leavesOf = (n: CategoryNode) => [n.name, ...n.subs.map((s) => `${n.name} / ${s}`)];
  const allLeaves = useMemo(() => nodes.flatMap(leavesOf), [nodes]);

  const isAll = selected.size === 0;
  const isNone = selected.has(FILTER_NONE);
  const isLeafChecked = (leaf: string) =>
    isAll || (!isNone && selected.has(leaf));

  // The concrete selected leaf set (resolving the ALL / NONE markers).
  const effective = () =>
    isAll
      ? new Set(allLeaves)
      : isNone
        ? new Set<string>()
        : new Set([...selected].filter((x) => x !== FILTER_NONE));

  // Normalise back to ALL (empty) / NONE ({FILTER_NONE}) / explicit subset.
  const commit = (eff: Set<string>) => {
    if (eff.size >= allLeaves.length) onChange(new Set());
    else if (eff.size === 0) onChange(new Set([FILTER_NONE]));
    else onChange(eff);
  };
  const toggleLeaf = (leaf: string) => {
    const eff = effective();
    if (eff.has(leaf)) eff.delete(leaf);
    else eff.add(leaf);
    commit(eff);
  };
  const toggleParent = (n: CategoryNode) => {
    const eff = effective();
    const leaves = leavesOf(n);
    const allOn = leaves.every((l) => eff.has(l));
    for (const l of leaves) {
      if (allOn) eff.delete(l);
      else eff.add(l);
    }
    commit(eff);
  };
  const parentState = (n: CategoryNode): "all" | "some" | "none" => {
    const leaves = leavesOf(n);
    const on = leaves.filter((l) => isLeafChecked(l)).length;
    return on === 0 ? "none" : on === leaves.length ? "all" : "some";
  };

  const selectedCount = isAll ? allLeaves.length : isNone ? 0 : selected.size;
  const summary = isNone
    ? "Ничего"
    : isAll
      ? `Все (${nodes.length})`
      : `Выбрано ${selectedCount}`;

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return nodes;
    return nodes.filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.subs.some((s) => s.toLowerCase().includes(q))
    );
  }, [nodes, q]);
  const active = useMemo(
    () => nodes.find((n) => n.name === activeParent) ?? null,
    [nodes, activeParent]
  );
  const activeSubs = useMemo(() => {
    if (!active) return [];
    if (!q || active.name.toLowerCase().includes(q)) return active.subs;
    return active.subs.filter((s) => s.toLowerCase().includes(q));
  }, [active, q]);

  // Portal positioning (mirrors MultiSelect) — float above the page content.
  type MenuPos = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };
  const [pos, setPos] = useState<MenuPos | null>(null);
  const MENU_W = 380;
  useLayoutEffect(() => {
    const el = btnRef.current;
    let next: MenuPos | null = null;
    if (open && el) {
      const r = el.getBoundingClientRect();
      const width = Math.max(r.width, MENU_W);
      const estH = 360;
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const flipUp = above > below && above >= Math.min(estH, 48);
      next = flipUp
        ? { left: r.left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(estH, above) }
        : { left: r.left, width, top: r.bottom + 4, maxHeight: Math.min(estH, below) };
    }
    setPos(next);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      const t = e.target;
      if (menuRef.current && t instanceof Node && menuRef.current.contains(t)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => {
          if (!open) {
            setQuery("");
            setActiveParent(nodes[0]?.name ?? null);
          }
          setOpen((o) => !o);
        }}
        className={clsx(
          "btn-ghost text-sm w-full justify-between",
          !isAll && "border-accent text-accent"
        )}
      >
        <span className="truncate max-w-[180px]">Категории: {summary}</span>
        <ChevronDown className="w-4 h-4 shrink-0" />
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
            <div
              ref={menuRef}
              className="fixed z-[80] card p-0 overflow-hidden flex flex-col"
              style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60">
                <span className="text-xs text-muted">{nodes.length} категорий</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onChange(new Set())}
                    disabled={isAll}
                    className="text-xs text-accent hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    Выбрать все
                  </button>
                  <button
                    onClick={() => onChange(new Set([FILTER_NONE]))}
                    disabled={isNone}
                    className="text-xs text-accent hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    Снять все
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
                <Search className="w-3.5 h-3.5 text-muted shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Поиск категории"
                  className="bg-transparent text-sm w-full outline-none"
                />
              </div>
              <div className="flex min-h-0 flex-1">
                {/* Left — parent categories */}
                <div className="w-1/2 overflow-y-auto border-r border-border/60">
                  {filtered.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted">Ничего не найдено</div>
                  ) : (
                    filtered.map((n) => {
                      const st = parentState(n);
                      const isActive = n.name === activeParent;
                      return (
                        <div
                          key={n.name}
                          onMouseEnter={() => n.subs.length > 0 && setActiveParent(n.name)}
                          className={clsx("flex items-center gap-1 pr-1", isActive && "bg-panel2")}
                        >
                          <input
                            type="checkbox"
                            checked={st === "all"}
                            ref={(el) => {
                              if (el) el.indeterminate = st === "some";
                            }}
                            onChange={() => toggleParent(n)}
                            className="accent-accent shrink-0 ml-2"
                          />
                          <button
                            type="button"
                            onClick={() => (n.subs.length > 0 ? setActiveParent(n.name) : toggleParent(n))}
                            className="flex-1 min-w-0 text-left px-1.5 py-1.5 text-sm flex items-center gap-2"
                          >
                            <CategoryDot category={n.name} size="w-4 h-4" />
                            <span className="truncate flex-1">{n.name}</span>
                            {n.subs.length > 0 && (
                              <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted" />
                            )}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                {/* Right — sub-categories of the active parent */}
                <div className="w-1/2 overflow-y-auto">
                  {active && active.subs.length > 0 ? (
                    <>
                      <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-panel2 cursor-pointer text-sm text-muted">
                        <input
                          type="checkbox"
                          checked={isLeafChecked(active.name)}
                          onChange={() => toggleLeaf(active.name)}
                          className="accent-accent shrink-0"
                        />
                        <span className="truncate">Без подкатегории</span>
                      </label>
                      {activeSubs.map((s) => {
                        const leaf = `${active.name} / ${s}`;
                        return (
                          <label
                            key={s}
                            className="flex items-center gap-2 px-2 py-1.5 hover:bg-panel2 cursor-pointer text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={isLeafChecked(leaf)}
                              onChange={() => toggleLeaf(leaf)}
                              className="accent-accent shrink-0"
                            />
                            <CategoryDot category={s} size="w-4 h-4" />
                            <span className="truncate">{s}</span>
                          </label>
                        );
                      })}
                    </>
                  ) : (
                    <div className="px-3 py-2 text-xs text-muted">
                      {active ? "Нет подкатегорий" : "Наведите на категорию"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
