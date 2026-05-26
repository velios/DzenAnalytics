import { useEffect, useState } from "react";
import { RefreshCw, CloudDownload, Check, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { useZenmoneyStore, type SyncResult } from "../store/useZenmoneyStore";
import { formatNum } from "../lib/format";

/**
 * Header quick-actions for Zenmoney sync.
 *
 * Layout: a single bordered "segmented" container holds the two
 * icon-buttons (incremental + full re-sync), separated by a thin
 * divider. It reads as one cluster, like a button group in
 * the macOS toolbar style.
 *
 *   • RefreshCw — incremental sync (`sync()`), the everyday button.
 *   • CloudDownload — full re-sync (`sync({force: true})`), behind a
 *     confirm() because it drops the local cache. Useful after mass
 *     renames in the mobile app, or when data feels stale.
 *
 * Both buttons are hidden when there's no Zenmoney token configured —
 * the Settings page is where you connect a token, so hiding here
 * keeps the header tidy for CSV-mode users.
 *
 * Result feedback drops down BELOW the buttons as an absolutely-
 * positioned toast — keeps the header row from reflowing and avoids
 * the chip pushing the search box off-screen. Auto-dismisses after
 * five seconds (animated fade-out the last ~180ms).
 */
export function HeaderSyncActions() {
  const token = useZenmoneyStore((s) => s.token);
  const status = useZenmoneyStore((s) => s.status);
  const error = useZenmoneyStore((s) => s.error);
  const lastSyncAt = useZenmoneyStore((s) => s.lastSyncAt);
  const loaded = useZenmoneyStore((s) => s.loaded);
  const hydrate = useZenmoneyStore((s) => s.hydrate);
  const sync = useZenmoneyStore((s) => s.sync);

  const [flash, setFlash] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  // Two-phase dismiss: while `closing` is true the toast plays its
  // fade-out animation, then unmounts. Keeps the visual exit smooth
  // instead of a hard pop.
  const [closing, setClosing] = useState(false);

  // Hydrate the token from IndexedDB on first mount so the buttons
  // appear straight away if the user is already connected (header
  // mounts before /import is ever visited).
  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);

  // Schedule: 5s visible, then 0.18s fade-out, then unmount.
  // `closing` is reset in `setFlash(...)` callers (not here) so this
  // effect can stay free of in-effect setState — matters for the
  // react-hooks/set-state-in-effect lint rule and for cleaner renders.
  useEffect(() => {
    if (!flash) return;
    const tFade = setTimeout(() => setClosing(true), 5000);
    const tDrop = setTimeout(() => setFlash(null), 5000 + 200);
    return () => {
      clearTimeout(tFade);
      clearTimeout(tDrop);
    };
  }, [flash]);

  if (!loaded || !token) return null;

  const busy = status === "syncing" || status === "checking";

  // Helper that resets the closing flag before showing a new toast.
  // Doing this here keeps the dismiss-effect free of inner setState
  // calls (which the lint rule warns about).
  function showFlash(next: { tone: "ok" | "err"; text: string }) {
    setClosing(false);
    setFlash(next);
  }

  function formatResult(r: SyncResult): string {
    if (r.full) return `Полный синк: ${formatNum(r.count)} операций.`;
    if (r.delta.transactions === 0 && r.delta.deletions === 0) {
      return `Без изменений. Всего ${formatNum(r.count)} операций.`;
    }
    const parts: string[] = [];
    if (r.delta.transactions > 0) parts.push(`+${formatNum(r.delta.transactions)} новых/изменённых`);
    if (r.delta.deletions > 0) parts.push(`${formatNum(r.delta.deletions)} удалено`);
    return `${parts.join(", ")}. Всего ${formatNum(r.count)} операций.`;
  }

  async function runIncremental() {
    if (busy) return;
    setFlash(null);
    try {
      const r = await sync();
      showFlash({ tone: "ok", text: formatResult(r) });
    } catch {
      showFlash({ tone: "err", text: useZenmoneyStore.getState().error || "Ошибка синхронизации" });
    }
  }

  async function runFull() {
    if (busy) return;
    if (
      !confirm(
        "Полный синк сбросит локальный кэш и заново скачает все данные. Используйте, если данные не сходятся или после массовых переименований категорий в Дзен-мани. Продолжить?"
      )
    )
      return;
    setFlash(null);
    try {
      const r = await sync({ force: true });
      showFlash({ tone: "ok", text: formatResult(r) });
    } catch {
      showFlash({ tone: "err", text: useZenmoneyStore.getState().error || "Ошибка синхронизации" });
    }
  }

  const lastSyncHuman = lastSyncAt
    ? `Последняя синхронизация: ${new Date(lastSyncAt).toLocaleString("ru-RU")}`
    : "Ещё не синхронизировано на этом устройстве";

  // One shared class for the inner icon-buttons. They sit inside the
  // bordered container, so they themselves don't carry a border — just
  // a hover/focus background tint and the error-state colour when the
  // store is in `error` and we don't have a flash up at the moment.
  const innerBtn =
    "group p-1.5 transition-colors text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:bg-accent/10";

  return (
    // `inline-flex items-center` on the wrapper instead of plain
    // block — without this the surrounding header `items-center` row
    // aligns the wrapper as a block element and the segmented control
    // ends up a hair higher than the gear/help icons next to it.
    <div className="relative inline-flex items-center">
      <div
        className={clsx(
          "inline-flex items-stretch rounded-lg border bg-panel2 overflow-hidden",
          error && !busy && !flash ? "border-expense/40" : "border-border"
        )}
      >
        <button
          type="button"
          onClick={runIncremental}
          disabled={busy}
          title={`Синхронизация с Дзен-мани (только изменения)\n${lastSyncHuman}`}
          className={clsx(innerBtn, "rounded-l-lg")}
        >
          <RefreshCw
            className={clsx(
              "w-4 h-4 transition-transform duration-500 ease-out",
              busy ? "animate-spin" : "group-hover:rotate-180"
            )}
          />
        </button>
        {/* 1-pixel divider between the two buttons — matches the
            container's border colour so it reads as one segmented
            control rather than two adjacent controls. */}
        <div className="w-px bg-border self-stretch" />
        <button
          type="button"
          onClick={runFull}
          disabled={busy}
          title="Полная синхронизация (сбросить кэш и заново скачать всё)"
          className={clsx(innerBtn, "rounded-r-lg")}
        >
          <CloudDownload className="w-4 h-4 transition-transform duration-300 ease-out group-hover:scale-110" />
        </button>
      </div>

      {/* Toast — absolutely positioned, right-aligned with the
          button group. Frosted-glass aesthetic (`backdrop-blur` over
          a translucent panel) keeps it readable on top of any page
          content but visually distinct from the solid header bar
          above. The tone (success / error) is carried by a thin
          left-edge accent bar and the icon colour, not by tinting the
          whole background — keeps the chip neutral and quiet. */}
      {flash && (
        <div
          role="status"
          aria-live="polite"
          className={clsx(
            "absolute right-0 top-full mt-2 z-30 w-[320px] sm:w-[360px] pointer-events-none",
            closing ? "animate-flash-out" : "animate-flash-in"
          )}
        >
          <div className="flex items-stretch overflow-hidden rounded-lg border border-border bg-panel/70 backdrop-blur-md shadow-lg ring-1 ring-black/5">
            {/* Tone accent bar — 3px wide, full height. Reads as a
                "status stripe" so the chip itself can stay neutral. */}
            <div
              className={clsx(
                "w-[3px] shrink-0",
                flash.tone === "ok" ? "bg-income" : "bg-expense"
              )}
            />
            <div className="flex items-start gap-2 px-3 py-2 text-xs leading-snug text-text/90">
              {flash.tone === "ok" ? (
                <Check className="w-3.5 h-3.5 shrink-0 mt-0.5 text-income" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-expense" />
              )}
              <span className="whitespace-normal break-words">{flash.text}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
