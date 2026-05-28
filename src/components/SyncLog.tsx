import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  History,
  Trash2,
  Info,
} from "lucide-react";
import {
  useSyncLogStore,
  type SyncLogEntry,
  type SyncLogStatus,
} from "../store/useSyncLogStore";
import { confirm } from "../store/useConfirmStore";

/**
 * Sync log table.
 *
 * Columns:
 *   • Тип            — human-readable kind: "Синхронизация", "Полная
 *                       синхронизация", "Push в облако", …
 *   • Дата-время     — full localized timestamp.
 *   • Новых          — for pulls: delta.transactions (new/changed).
 *                       For pushes: accepted (sent successfully).
 *                       For snapshots / restores: "—".
 *   • Всего          — total transactions in local cache *after* the op.
 *                       Lets the user see "did the count grow?".
 *   • Длительность   — wall-clock duration in ms / s.
 *   • Статус         — "Успешно" / "Частично" / "Ошибка" with colour.
 *
 * Click a row to expand: shows error text (for errors) + skipped items
 * (for partial pushes). Status / type icons let the user scan the table
 * vertically without reading every label.
 *
 * Pagination: 10 / 20 / 50 / 100 per page (default 10). Buttons appear
 * only when there's more than one page.
 */

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 10;

export function SyncLog() {
  const entries = useSyncLogStore((s) => s.entries);
  const loaded = useSyncLogStore((s) => s.loaded);
  const hydrate = useSyncLogStore((s) => s.hydrate);
  const clear = useSyncLogStore((s) => s.clear);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState<number>(1);

  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);

  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  // Clamp page if entries shrink (e.g. after Clear) so we never end up
  // on an empty page.
  const safePage = Math.min(page, totalPages);
  if (safePage !== page) {
    // setState during render is fine here because it's idempotent —
    // React will short-circuit on the next pass.
    setTimeout(() => setPage(safePage), 0);
  }

  const visible = useMemo(
    () => entries.slice((safePage - 1) * pageSize, safePage * pageSize),
    [entries, safePage, pageSize]
  );

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-accent2" />
          <span className="font-medium">Лог синхронизаций</span>
          {entries.length > 0 && (
            <span className="text-xs text-muted">· {entries.length}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-muted flex items-center gap-2">
            Записей на странице:
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="input text-xs !py-1 !px-2 !w-auto"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {entries.length > 0 && (
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: "Очистить лог?",
                  message:
                    "История синхронизаций будет удалена. Действие необратимо.",
                  confirmLabel: "Очистить",
                  tone: "danger",
                });
                if (ok) await clear();
              }}
              className="btn-ghost text-xs text-muted"
              title="Удалить все записи"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Очистить
            </button>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-muted">
          История пуста. После первой синхронизации, push'а или снимка
          сюда упадут записи о результатах.
        </p>
      ) : (
        <>
          <div>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border">
                  <th className="font-medium px-2 py-2 w-6" />
                  <th className="font-medium px-2 py-2">Тип</th>
                  <th className="font-medium px-2 py-2">Дата-время</th>
                  <th className="font-medium px-2 py-2 hidden md:table-cell">
                    <HeaderWithHint
                      label="Новых транзакций"
                      hint={
                        "Сколько записей пришло от сервера в этом синке.\n" +
                        "Для синхронизации — это новые/изменённые операции.\n" +
                        "Для полной — весь объём целиком (включая удалённые\n" +
                        "и нулевые служебные записи).\n" +
                        "Для Push — сколько правок ушло в облако."
                      }
                    />
                  </th>
                  <th className="font-medium px-2 py-2 hidden md:table-cell">
                    <HeaderWithHint
                      label="Всего транзакций"
                      hint={
                        "Сколько операций видно в приложении после синка\n" +
                        "(удалённые и нулевые служебные записи отфильтрованы).\n" +
                        "Поэтому это число может быть меньше «Новых\nтранзакций» при полной синхронизации."
                      }
                    />
                  </th>
                  <th className="font-medium px-2 py-2 hidden md:table-cell">Длительность</th>
                  <th className="font-medium px-2 py-2">Статус</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <LogTableRow
                    key={e.id}
                    entry={e}
                    expanded={expanded.has(e.id)}
                    onToggle={() => toggle(e.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3 text-xs text-muted">
              <span>
                Страница {safePage} из {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="btn-ghost !p-1.5 text-xs disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Предыдущая"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="btn-ghost !p-1.5 text-xs disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Следующая"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LogTableRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: SyncLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasDetails =
    !!entry.error ||
    (entry.details?.skipped && entry.details.skipped.length > 0);

  // "Новых": for pulls = delta.transactions (new/changed); for pushes =
  // accepted (sent to cloud). Snapshots/restores have no semantic value
  // here so we render an em-dash.
  const newCount =
    entry.kind === "pull"
      ? entry.details?.counts?.transactions
      : entry.kind === "push"
        ? entry.details?.counts?.accepted
        : undefined;
  const totalCount = entry.details?.counts?.total;

  return (
    <>
      <tr
        onClick={hasDetails ? onToggle : undefined}
        className={`border-b border-border/40 last:border-b-0 ${
          hasDetails ? "cursor-pointer hover:bg-panel2/40" : ""
        } transition-colors`}
      >
        <td className="px-2 py-2 align-top">
          {hasDetails ? (
            expanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted" />
            )
          ) : null}
        </td>
        <td className="px-2 py-2 align-top">
          <div className="font-medium">{entry.title}</div>
          {/* Human summary as a sub-line so the result is always
              visible without expanding — e.g. "удалено: 1",
              "Отправлено: 1", "+3 новых/изменённых". For deletions
              this is the only place the count shows, since the
              numeric columns track new/total transactions only. */}
          {entry.summary && (
            <div
              className="text-xs text-muted"
              title={capitalize(entry.summary)}
            >
              {capitalize(entry.summary)}
            </div>
          )}
        </td>
        <td className="px-2 py-2 align-top text-muted text-xs tabular-nums whitespace-nowrap">
          {new Date(entry.ts).toLocaleString("ru-RU")}
        </td>
        <td className="px-2 py-2 align-top tabular-nums hidden md:table-cell">
          {newCount !== undefined ? formatN(newCount) : "—"}
        </td>
        <td className="px-2 py-2 align-top tabular-nums hidden md:table-cell">
          {totalCount !== undefined ? formatN(totalCount) : "—"}
        </td>
        <td className="px-2 py-2 align-top tabular-nums text-muted text-xs whitespace-nowrap hidden md:table-cell">
          {typeof entry.durationMs === "number"
            ? formatDuration(entry.durationMs)
            : "—"}
        </td>
        <td className="px-2 py-2 align-top">
          <StatusBadge status={entry.status} />
        </td>
      </tr>
      {expanded && hasDetails && (
        <tr className="bg-panel2/30 border-b border-border/40">
          <td colSpan={7} className="px-3 py-3">
            <div className="text-xs space-y-2">
              {entry.error && (
                <div className="flex items-start gap-2 p-2 rounded-md bg-expense/5 border border-expense/30 text-expense">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span className="whitespace-pre-wrap break-words font-mono text-[11px]">
                    {entry.error}
                  </span>
                </div>
              )}
              {entry.details?.skipped && entry.details.skipped.length > 0 && (
                <details>
                  <summary className="text-accent cursor-pointer hover:underline">
                    Пропущенные правки ({entry.details.skipped.length})
                  </summary>
                  <div className="mt-2 max-h-48 overflow-y-auto space-y-1 -mx-1 px-1">
                    {entry.details.skipped.map((s) => (
                      <div
                        key={s.id}
                        className="py-1 border-b border-border/40 last:border-b-0 text-muted"
                      >
                        <div className="font-mono text-[10px] truncate">
                          {s.id}
                        </div>
                        <div>{s.reason}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Column header with a click-triggered popover. Native `title` was too
 * slow (~500 ms hover delay) and visually inconsistent with the rest
 * of the app, so we render a real positioned panel on click and
 * dismiss on outside-click / Escape. The popover positions below the
 * icon (top-full) and uses the same panel colours as cards.
 *
 * Multi-line `hint` strings are rendered with `whitespace-pre-line`
 * so `\n` produces a real line break.
 */
function HeaderWithHint({ label, hint }: { label: string; hint: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className="relative inline-flex items-center gap-1 whitespace-nowrap"
    >
      {label}
      <button
        type="button"
        onClick={(e) => {
          // Don't let the click bubble up to the document-level
          // dismiss handler in the same tick.
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label={`Подсказка: ${label}`}
        className={`text-muted/70 hover:text-text transition-colors cursor-pointer ${
          open ? "text-accent" : ""
        }`}
      >
        <Info className="w-3 h-3" />
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute bottom-full left-0 mb-2 z-20 w-72 p-3 rounded-lg border border-border bg-panel shadow-lg text-xs text-text whitespace-pre-line normal-case font-normal"
        >
          {hint}
        </div>
      )}
    </span>
  );
}

function StatusBadge({ status }: { status: SyncLogStatus }) {
  const conf = {
    ok: {
      Icon: CheckCircle2,
      label: "Успешно",
      cls: "text-income bg-income/10 border-income/30",
    },
    partial: {
      Icon: AlertCircle,
      label: "Частично",
      cls: "text-warn bg-warn/10 border-warn/30",
    },
    error: {
      Icon: AlertTriangle,
      label: "Ошибка",
      cls: "text-expense bg-expense/10 border-expense/30",
    },
  }[status];
  const { Icon, label, cls } = conf;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-md border ${cls} whitespace-nowrap`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function formatN(n: number): string {
  return n.toLocaleString("ru-RU");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} мс`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} с`;
  return `${Math.floor(ms / 60_000)} мин ${Math.floor((ms % 60_000) / 1000)} с`;
}
