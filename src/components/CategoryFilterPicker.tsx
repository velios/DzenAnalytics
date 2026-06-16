import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";
import clsx from "clsx";
import { FILTER_NONE } from "../store/useFiltersStore";
import { pluralRu } from "../lib/plural";
import { CategoryDot } from "./CategoryDot";

export interface CategoryNode {
  name: string;
  /** True when the category has «bare» transactions (tagged with just the
   *  parent, no sub) — a distinct leaf, toggled only via the parent checkbox. */
  hasBare: boolean;
  /** Sub-category titles (sorted). */
  subs: string[];
}

/**
 * Cascade MULTI-select for the global category filter: parent categories on the
 * left, the active parent's sub-categories on the right — same shape as the
 * edit-modal picker, with checkboxes (issue #9).
 *
 * Pure leaf model — selection keys equal `categoryFull` (empty = ALL,
 * `{FILTER_NONE}` = NONE):
 *   - the bare category «Еда» (its no-sub transactions) — a leaf only when the
 *     category actually has such transactions (`hasBare`);
 *   - each «Еда / Кафе».
 * Category and sub-category are independent: ticking a sub never selects the
 * parent's bare leaf, and vice-versa. The parent checkbox just bulk-toggles all
 * of the category's leaves.
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
  // Which categories are expanded (accordion, non-search view).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const isAll = selected.size === 0;
  const isNone = selected.has(FILTER_NONE);
  const subKey = (cat: string, sub: string) => `${cat} / ${sub}`;

  // Leaf keys of a category = its bare leaf (if any) + its sub leaves.
  const leavesOf = (n: CategoryNode) => [
    ...(n.hasBare ? [n.name] : []),
    ...n.subs.map((s) => subKey(n.name, s)),
  ];
  // eslint-disable-next-line react-hooks/exhaustive-deps -- leavesOf is pure of nodes
  const allLeaves = useMemo(() => nodes.flatMap(leavesOf), [nodes]);

  const leafChecked = (leaf: string) =>
    isAll || (!isNone && selected.has(leaf));
  // Resolve the ALL / NONE markers into a concrete leaf set.
  const effective = () =>
    isAll
      ? new Set(allLeaves)
      : isNone
        ? new Set<string>()
        : new Set([...selected].filter((x) => x !== FILTER_NONE));
  const commit = (eff: Set<string>) => {
    if (eff.size >= allLeaves.length) onChange(new Set()); // everything → ALL
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

  const catState = (n: CategoryNode): "all" | "some" | "none" => {
    const leaves = leavesOf(n);
    const on = leaves.filter(leafChecked).length;
    return on === 0 ? "none" : on === leaves.length ? "all" : "some";
  };
  const subChecked = (n: CategoryNode, sub: string) =>
    leafChecked(subKey(n.name, sub));

  const subCount = nodes.reduce((s, n) => s + n.subs.length, 0);
  const total = nodes.length + subCount; // categories + sub-categories

  const summary = isNone
    ? "Ничего"
    : isAll
      ? `Все (${total})` // total incl. sub-categories
      : `Выбрано ${selected.size}`;

  // Dropdown header — break it down: «N категорий и M подкатегорий».
  const totalLabel =
    `${nodes.length} ${pluralRu(nodes.length, ["категория", "категории", "категорий"])}` +
    ` и ${subCount} ${pluralRu(subCount, ["подкатегория", "подкатегории", "подкатегорий"])}`;

  const q = query.trim().toLowerCase();

  // While searching, a FLAT list of every matching leaf with its full path —
  // so identically-named subs in different parents («Животные / Кот»,
  // «Тест / Кот») are each directly toggleable, no hover/cascade needed.
  type SearchItem =
    | { key: string; kind: "cat"; node: CategoryNode }
    | { key: string; kind: "sub"; node: CategoryNode; sub: string };
  const searchResults = useMemo<SearchItem[] | null>(() => {
    if (!q) return null;
    const items: SearchItem[] = [];
    for (const n of nodes) {
      if (n.name.toLowerCase().includes(q))
        items.push({ key: `c:${n.name}`, kind: "cat", node: n });
      for (const s of n.subs) {
        if (s.toLowerCase().includes(q))
          items.push({ key: `s:${n.name}/${s}`, kind: "sub", node: n, sub: s });
      }
    }
    return items;
  }, [q, nodes]);

  // Portal positioning — float above page content (mirrors MultiSelect).
  type MenuPos = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };
  const [pos, setPos] = useState<MenuPos | null>(null);
  const MENU_W = 360;
  useLayoutEffect(() => {
    const el = btnRef.current;
    let next: MenuPos | null = null;
    if (open && el) {
      const r = el.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, MENU_W), window.innerWidth - 16);
      const estH = 400;
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const flipUp = above > below && above >= Math.min(estH, 48);
      let left = r.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      if (left < 8) left = 8;
      next = flipUp
        ? { left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(estH, above) }
        : { left, width, top: r.bottom + 4, maxHeight: Math.min(estH, below) };
    }
    setPos(next);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    // Close only on resize / Escape — NOT on scroll: clicking a checkbox near
    // the viewport edge can scroll the window, which used to close the picker
    // mid-selection. Outside clicks are handled by the overlay below.
    const onResize = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => {
          if (!open) setQuery("");
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
                <span className="text-xs text-muted">{totalLabel}</span>
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
                  placeholder="Поиск категории и подкатегории"
                  className="bg-transparent text-sm w-full outline-none"
                />
              </div>
              {searchResults ? (
                /* Search — flat, directly-toggleable list with full paths. */
                <div className="overflow-y-auto min-h-0 flex-1">
                  {searchResults.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted">Ничего не найдено</div>
                  ) : (
                    searchResults.map((item) =>
                      item.kind === "cat" ? (
                        (() => {
                          const st = catState(item.node);
                          return (
                            <label
                              key={item.key}
                              className="flex items-center gap-2 px-3 py-1.5 hover:bg-panel2 cursor-pointer text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={st === "all"}
                                ref={(el) => {
                                  if (el) el.indeterminate = st === "some";
                                }}
                                onChange={() => toggleParent(item.node)}
                                className="accent-accent shrink-0"
                              />
                              <CategoryDot category={item.node.name} size="w-4 h-4" />
                              <span className="truncate">{item.node.name}</span>
                            </label>
                          );
                        })()
                      ) : (
                        <label
                          key={item.key}
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-panel2 cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={leafChecked(subKey(item.node.name, item.sub))}
                            onChange={() => toggleLeaf(subKey(item.node.name, item.sub))}
                            className="accent-accent shrink-0"
                          />
                          <CategoryDot category={item.sub} parent={item.node.name} size="w-4 h-4" />
                          <span className="truncate">
                            <span className="text-muted">{item.node.name} / </span>
                            {item.sub}
                          </span>
                        </label>
                      )
                    )
                  )}
                </div>
              ) : (
                /* Accordion — sub-categories expand under a category on click. */
                <div className="overflow-y-auto min-h-0 flex-1">
                  {nodes.map((n) => {
                    const st = catState(n);
                    const isOpen = expanded.has(n.name);
                    return (
                      <div key={n.name}>
                        <div className="flex items-center gap-1">
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
                            onClick={() =>
                              n.subs.length > 0 ? toggleExpand(n.name) : toggleParent(n)
                            }
                            className="flex-1 min-w-0 text-left px-1.5 py-1.5 text-sm flex items-center gap-2 hover:bg-panel2 rounded"
                          >
                            <CategoryDot category={n.name} size="w-4 h-4" />
                            <span className="truncate flex-1">{n.name}</span>
                            {n.subs.length > 0 && (
                              <span className="text-[10px] text-muted shrink-0">
                                {n.subs.length}
                              </span>
                            )}
                            {n.subs.length > 0 && (
                              <ChevronDown
                                className={`w-3.5 h-3.5 shrink-0 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
                              />
                            )}
                          </button>
                        </div>
                        {n.subs.length > 0 && (
                          <div
                            className={`grid transition-all duration-200 ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                          >
                            <div className="overflow-hidden">
                              {n.subs.map((s) => (
                                <label
                                  key={s}
                                  className="flex items-center gap-2 pl-9 pr-2 py-1.5 hover:bg-panel2 cursor-pointer text-sm"
                                >
                                  <input
                                    type="checkbox"
                                    checked={subChecked(n, s)}
                                    onChange={() => toggleLeaf(subKey(n.name, s))}
                                    className="accent-accent shrink-0"
                                  />
                                  <CategoryDot category={s} parent={n.name} size="w-4 h-4" />
                                  <span className="truncate">{s}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
