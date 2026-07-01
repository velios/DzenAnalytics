// Editor for a category's «обязательная» (`tag.required`) flag — the field
// Zenmoney uses to mark mandatory expenses, and the source the 50/30/20 page
// reads to split needs vs wants. Edits are optimistic locally (the split
// updates instantly) and ride to the cloud through the normal Push flow
// (same modes / snapshot safety as transaction edits).
//
// Semantics: `null` (not set) and `true` both mean «обязательная» (default —
// mandatory); only an explicit `false` is «необязательная». So the control is
// a two-state Обязательные / Необязательные toggle, and the 50/30/20 page
// treats `required !== false` as a need.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Lock, Search, UploadCloud, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";
import {
  getCategoryTagsFromCache,
  useZenmoneyStore,
  type CategoryTag,
} from "../store/useZenmoneyStore";
import { useTagEditsStore } from "../store/useTagEditsStore";
import { useCategoryMetaStore } from "../store/useCategoryMetaStore";
import { colorForCategory } from "../lib/categoryColor";
import { CategoryDot } from "./CategoryDot";

/** «Обязательная» if `required` is not explicitly `false` (null/true → true). */
function isObligatory(required: boolean | null): boolean {
  return required !== false;
}

/** Income / expense nature of a category, straight from the API tag flags. */
function categoryType(t: CategoryTag): string {
  if (t.showOutcome && t.showIncome) return "Расходная/Доходная";
  if (t.showIncome) return "Доходная";
  if (t.showOutcome) return "Расходная";
  return "—";
}

export function CategoryRequiredEditor() {
  const serverTimestamp = useZenmoneyStore((s) => s.serverTimestamp);
  const pushMode = useZenmoneyStore((s) => s.pushMode);
  const token = useZenmoneyStore((s) => s.token);
  const pushStatus = useZenmoneyStore((s) => s.pushStatus);

  const tagEdits = useTagEditsStore((s) => s.edits);

  const [tags, setTags] = useState<CategoryTag[] | null | "loading">("loading");
  const [query, setQuery] = useState("");
  // Collapsed by default — the full table is rarely needed open.
  const [open, setOpen] = useState(false);
  // Per-root expand/collapse of sub-categories (mirrors the legend tables).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Category colours (for the parent→child rail), keyed by title.
  const meta = useCategoryMetaStore((s) => s.meta);

  // (Re)load the category tags from cache. Re-runs after a sync (serverTimestamp
  // bumps) so freshly-pulled `required` values show up.
  useEffect(() => {
    let alive = true;
    getCategoryTagsFromCache().then((t) => {
      if (alive) setTags(t);
    });
    return () => {
      alive = false;
    };
  }, [serverTimestamp]);

  // Flatten tags into display order: each root followed by its sub-tags
  // (`depth: 1`). When searching, a group survives if the root OR any child
  // matches; within a matched-root group all children show, otherwise only the
  // matching children (the root stays as their header).
  const groups = useMemo(() => {
    if (!Array.isArray(tags)) return [];
    const q = query.trim().toLowerCase();
    const hit = (t: CategoryTag) => t.title.toLowerCase().includes(q);
    const roots = tags.filter((t) => !t.parent);
    const kids = new Map<string, CategoryTag[]>();
    for (const t of tags) {
      if (!t.parent) continue;
      const arr = kids.get(t.parent);
      if (arr) arr.push(t);
      else kids.set(t.parent, [t]);
    }
    const out: { root: CategoryTag; children: CategoryTag[] }[] = [];
    for (const root of roots) {
      const children = kids.get(root.id) ?? [];
      const rootHit = !q || hit(root);
      const anyChildHit = children.some(hit);
      if (q && !rootHit && !anyChildHit) continue;
      // Searching with a non-matching root → keep only matching children
      // (the root stays as their header).
      const shown = q && !rootHit ? children.filter(hit) : children;
      out.push({ root, children: shown });
    }
    return out;
  }, [tags, query]);

  const pendingCount = Object.keys(tagEdits).length;
  // Searching force-expands every group so matches are visible; otherwise it's
  // the per-root toggle. The header chevron expands / collapses all at once.
  const searching = query.trim().length > 0;
  const expandableRoots = groups.filter((g) => g.children.length > 0);
  const allExpanded =
    expandableRoots.length > 0 && expandableRoots.every((g) => expanded.has(g.root.id));
  const toggleAll = () =>
    setExpanded(allExpanded ? new Set() : new Set(expandableRoots.map((g) => g.root.id)));
  const toggleRoot = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Move a category to the «обязательные» or «необязательные» bucket. We store
  // an explicit true/false only when it crosses the bucket boundary of the
  // cached value; landing back on the cached bucket clears the overlay (so no
  // no-op push, and `null` stays `null` instead of churning to `true`). The
  // optimistic categoryMeta write keys by TITLE for roots and by the FULL PATH
  // «Родитель / Подкатегория» for sub-tags — both feed the per-transaction
  // obligatory split (#5), so the analytics update instantly.
  async function setObligatory(tag: CategoryTag, obligatory: boolean) {
    const cacheVal = tag.required ?? null;
    const isRoot = !tag.parent;
    const parentTitle = isRoot
      ? undefined
      : (Array.isArray(tags) ? tags.find((t) => t.id === tag.parent)?.title : undefined);
    const metaKey = isRoot
      ? tag.title
      : parentTitle
        ? `${parentTitle} / ${tag.title}`
        : null;
    if (obligatory === isObligatory(cacheVal)) {
      await useTagEditsStore.getState().clearMany([tag.id]);
      if (metaKey) await useCategoryMetaStore.getState().setRequired(metaKey, cacheVal);
    } else {
      const next = obligatory ? true : false;
      await useTagEditsStore.getState().setRequired(tag.id, next);
      if (metaKey) await useCategoryMetaStore.getState().setRequired(metaKey, next);
    }
  }

  async function pushNow() {
    if (!token) return;
    await useZenmoneyStore
      .getState()
      .pushPendingEdits()
      .catch(() => {
        /* surfaced via pushError + sync log */
      });
  }

  async function resetEdits() {
    // Clear only the local overlay. The cloud value is untouched; the next
    // sync re-derives categoryMeta from the cache, reverting the display.
    await useTagEditsStore.getState().clearAll();
  }

  // CSV mode — no Zenmoney cache, nothing to edit / sync.
  if (tags === null) {
    return (
      <div className="card card-pad">
        <div className="font-semibold mb-1 flex items-center gap-2">
          <Lock className="w-4 h-4 text-warn" /> Обязательность доходов и расходов в категориях
        </div>
        <p className="text-sm text-muted">
          Редактирование обязательности доступно только в режиме Zenmoney API —
          нужен живой список категорий и синхронизация. Подключите Дзен-мани в
          настройках, чтобы помечать категории как обязательные и
          необязательные.
        </p>
      </div>
    );
  }

  return (
    <div className="card card-pad space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2 font-semibold text-left min-w-0"
        >
          <ChevronDown
            className={clsx(
              "w-4 h-4 text-muted transition-transform shrink-0",
              open && "rotate-180"
            )}
          />
          <Lock className="w-4 h-4 text-warn shrink-0" />
          <span className="truncate">Обязательность доходов и расходов в категориях</span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {pendingCount > 0 && (
            <span className="text-xs text-warn tabular-nums">
              правок: {pendingCount}
            </span>
          )}
          {pendingCount > 0 && (
            <button
              onClick={resetEdits}
              className="text-xs flex items-center gap-1 text-muted hover:text-text"
              title="Сбросить несохранённые правки (облако не меняется)"
            >
              <RotateCcw className="w-3.5 h-3.5" /> сбросить
            </button>
          )}
          {pushMode === "manual" && pendingCount > 0 && (
            <button
              onClick={pushNow}
              disabled={!token || pushStatus === "syncing"}
              className="text-xs flex items-center gap-1 px-2 py-1 rounded-md bg-accent text-accent-fg disabled:opacity-50"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              {pushStatus === "syncing" ? "Отправка…" : "Отправить в облако"}
            </button>
          )}
        </div>
      </div>

      {open && (
        <>
          <p className="text-xs text-muted">
            Здесь можно отредактировать обязательность категорий Дзен-мани — как
            расходных, так и доходных. По умолчанию категории (если вы их не
            редактировали в приложении) считаются обязательными. Параметр
            используется в аналитике обязательных и необязательных потоков —
            например, в правиле{" "}
            <Link to="/50-30-20" className="text-accent hover:underline">
              50/30/20
            </Link>{" "}
            и в оценке финансового здоровья (доля обязательных трат).
          </p>

          <div className="flex items-center gap-2 bg-panel2 rounded-lg px-2 py-1 border border-border">
            <Search className="w-3.5 h-3.5 text-muted shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск категории…"
          className="bg-transparent text-sm flex-1 outline-none min-w-0"
        />
        {query && (
          <button onClick={() => setQuery("")} className="text-xs text-muted hover:text-text">
            ✕
          </button>
        )}
      </div>

      {/* One scroll container holds the sticky header AND the rows, so both
          share the exact same content width and scrollbar gutter — the columns
          line up regardless of whether the list overflows. */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div
          className="max-h-[440px] overflow-y-auto"
          // Obeys the «Размер текста в таблицах» slider — rows inherit this.
          style={{ fontSize: "var(--tbl-font)" }}
        >
          <div className="sticky top-0 z-10 bg-panel border-b border-border flex items-center gap-3 px-3 py-2 text-[0.85em] text-muted uppercase tracking-wide">
            <span className="flex-1 min-w-0">Категория</span>
            <span className="hidden sm:block w-48 shrink-0">Тип категории</span>
            <span className="w-80 shrink-0 text-center">Обязательность</span>
            <span className="w-8 shrink-0 flex items-center justify-center">
              {!searching && expandableRoots.length > 0 && (
                <button
                  onClick={toggleAll}
                  title={allExpanded ? "Свернуть все" : "Развернуть все"}
                  aria-label={allExpanded ? "Свернуть все" : "Развернуть все"}
                  className="-m-1 p-1 rounded-md text-muted hover:text-accent hover:bg-panel2"
                >
                  <ChevronDown
                    className={clsx(
                      "w-4 h-4 transition-transform duration-300",
                      allExpanded && "rotate-180"
                    )}
                  />
                </button>
              )}
            </span>
          </div>

          {groups.length === 0 ? (
            <div className="text-sm text-muted py-6 text-center">
              {tags.length === 0 ? "Категории не найдены." : "Ничего не найдено."}
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {groups.map(({ root, children }) => {
                const isOpen = searching || expanded.has(root.id);
                const hasKids = children.length > 0;
                const rail = colorForCategory(root.title, meta);
                const rEdit = tagEdits[root.id];
                const rObl = isObligatory(rEdit ? rEdit.required : root.required ?? null);
                return (
                  <div key={root.id}>
                    <div className="flex items-center gap-3 px-3 py-1.5 hover:bg-panel2/40">
                      <span className="flex items-center gap-2 min-w-0 flex-1">
                        {rEdit && <span className="w-1.5 h-1.5 rounded-full bg-warn shrink-0" />}
                        <CategoryDot category={root.title} size="w-7 h-7" />
                        <span className="truncate">{root.title}</span>
                      </span>
                      <span className="hidden sm:block w-48 shrink-0 text-muted truncate">
                        {categoryType(root)}
                      </span>
                      <div className="flex bg-panel2 rounded-lg p-0.5 border border-border shrink-0 w-80">
                        <button
                          onClick={() => setObligatory(root, true)}
                          title="Обязательная — нужда (50%) на странице 50/30/20"
                          className={clsx(
                            "flex-1 text-center px-2 py-1 whitespace-nowrap rounded-md",
                            rObl ? "bg-warn text-white" : "text-muted hover:text-text"
                          )}
                        >
                          Обязательная
                        </button>
                        <button
                          onClick={() => setObligatory(root, false)}
                          title="Необязательная — желание (30%) на странице 50/30/20"
                          className={clsx(
                            "flex-1 text-center px-2 py-1 whitespace-nowrap rounded-md",
                            !rObl ? "bg-accent2 text-white" : "text-muted hover:text-text"
                          )}
                        >
                          Необязательная
                        </button>
                      </div>
                      <span className="w-8 shrink-0 flex items-center justify-center">
                        {hasKids && (
                          <button
                            onClick={() => toggleRoot(root.id)}
                            title={isOpen ? "Свернуть" : "Подкатегории"}
                            className="p-1 rounded-md text-muted hover:text-accent hover:bg-panel2"
                          >
                            {isOpen ? (
                              <ChevronDown className="w-5 h-5" />
                            ) : (
                              <ChevronRight className="w-5 h-5" />
                            )}
                          </button>
                        )}
                      </span>
                    </div>
                    {isOpen && hasKids && (
                      <div className="mb-2" style={{ marginLeft: "19px", borderLeft: `3px solid ${rail}` }}>
                        {children.map((c) => {
                          const cEdit = tagEdits[c.id];
                          const cObl = isObligatory(cEdit ? cEdit.required : c.required ?? null);
                          return (
                            <div
                              key={c.id}
                              className="flex items-center gap-3 pl-2 pr-3 py-1.5 hover:bg-panel2/40"
                            >
                              <span className="flex items-center gap-2 min-w-0 flex-1">
                                {cEdit && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-warn shrink-0" />
                                )}
                                <CategoryDot
                                  category={c.title}
                                  parent={root.title}
                                  fallback={rail}
                                  size="w-6 h-6"
                                />
                                <span className="truncate text-muted">{c.title}</span>
                              </span>
                              <span className="hidden sm:block w-48 shrink-0 text-muted truncate">
                                {categoryType(c)}
                              </span>
                              <div className="flex bg-panel2 rounded-lg p-0.5 border border-border shrink-0 w-80">
                                <button
                                  onClick={() => setObligatory(c, true)}
                                  title="Обязательная — нужда (50%) на странице 50/30/20"
                                  className={clsx(
                                    "flex-1 text-center px-2 py-1 whitespace-nowrap rounded-md",
                                    cObl ? "bg-warn text-white" : "text-muted hover:text-text"
                                  )}
                                >
                                  Обязательная
                                </button>
                                <button
                                  onClick={() => setObligatory(c, false)}
                                  title="Необязательная — желание (30%) на странице 50/30/20"
                                  className={clsx(
                                    "flex-1 text-center px-2 py-1 whitespace-nowrap rounded-md",
                                    !cObl ? "bg-accent2 text-white" : "text-muted hover:text-text"
                                  )}
                                >
                                  Необязательная
                                </button>
                              </div>
                              <span className="w-8 shrink-0" />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
}
