import { useEffect, useRef, useState } from "react";
import { Cloud, CloudDownload, CloudUpload, Loader2, Settings as SettingsIcon } from "lucide-react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { useZenmoneyStore } from "../store/useZenmoneyStore";
import { useEditsStore } from "../store/useEditsStore";

/**
 * Header-level cloud sync menu: a single icon next to the Settings /
 * Help buttons that opens a small popover with the two operations the
 * user touches most while iterating on edits — pull and push.
 *
 * Hidden entirely when no Zenmoney token is configured (CSV-only mode);
 * the icon does nothing useful in that case and the slot would only
 * add noise.
 *
 * Badge: pending edit count when push is enabled. Keeps the user aware
 * of how many local changes are queued without making them open
 * Settings to find out.
 */
export function CloudSyncQuickActions() {
  const zenToken = useZenmoneyStore((s) => s.token);
  const status = useZenmoneyStore((s) => s.status);
  const lastSyncAt = useZenmoneyStore((s) => s.lastSyncAt);
  const sync = useZenmoneyStore((s) => s.sync);

  const pushEnabled = useZenmoneyStore((s) => s.pushEnabled);
  const pushStatus = useZenmoneyStore((s) => s.pushStatus);
  const pushError = useZenmoneyStore((s) => s.pushError);
  const lastPushAt = useZenmoneyStore((s) => s.lastPushAt);
  const lastPushResult = useZenmoneyStore((s) => s.lastPushResult);
  const pushPendingEdits = useZenmoneyStore((s) => s.pushPendingEdits);

  const edits = useEditsStore((s) => s.edits);
  const editsLoaded = useEditsStore((s) => s.loaded);
  const hydrateEdits = useEditsStore((s) => s.hydrate);
  useEffect(() => {
    if (!editsLoaded) hydrateEdits();
  }, [editsLoaded, hydrateEdits]);
  const pendingCount = Object.keys(edits).length;

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!zenToken) return null;

  const isSyncing = status === "syncing";
  const isPushing = pushStatus === "syncing";
  const busy = isSyncing || isPushing;
  const showPushBadge = pushEnabled && pendingCount > 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Синхронизация с Дзен-мани"
        className={clsx(
          "group relative p-1.5 rounded-lg border transition-colors",
          open
            ? "bg-accent/10 border-accent/30 text-accent"
            : "border-border bg-panel2 text-muted hover:text-accent hover:border-accent/50"
        )}
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Cloud className="w-4 h-4" />
        )}
        {showPushBadge && !busy && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-accent2 text-white text-[10px] font-semibold leading-none flex items-center justify-center px-1 tabular-nums"
            title={`${pendingCount} локальных правок ждут отправки`}
          >
            {pendingCount > 99 ? "99+" : pendingCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-80 card p-3 z-20 text-sm">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-border">
            <div className="font-semibold flex items-center gap-2">
              <Cloud className="w-4 h-4 text-accent" />
              Дзен-мани
            </div>
            <Link
              to="/import"
              onClick={() => setOpen(false)}
              className="text-muted hover:text-accent p-1"
              title="Все настройки синхронизации"
            >
              <SettingsIcon className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Pull row */}
          <div className="flex items-start gap-3 py-2">
            <CloudDownload className="w-4 h-4 text-accent mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">Синхронизация</div>
              <div className="text-xs text-muted truncate">
                {lastSyncAt
                  ? `Последняя: ${new Date(lastSyncAt).toLocaleString("ru-RU")}`
                  : "Ещё не было"}
              </div>
            </div>
            <button
              onClick={async () => {
                try {
                  await sync();
                } catch {
                  /* error already in store */
                }
              }}
              disabled={busy}
              className="btn-primary !px-3 !py-1 text-xs whitespace-nowrap"
            >
              {isSyncing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CloudDownload className="w-3.5 h-3.5" />
              )}
              {isSyncing ? "..." : "Pull"}
            </button>
          </div>

          {/* Push row — only meaningful when push is opt-in enabled */}
          {pushEnabled ? (
            <div className="flex items-start gap-3 py-2 border-t border-border/40">
              <CloudUpload className="w-4 h-4 text-warn mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">
                  Push в облако{" "}
                  {pendingCount > 0 && (
                    <span className="text-accent2 tabular-nums">
                      ({pendingCount})
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted truncate">
                  {pendingCount === 0
                    ? "Нет правок к отправке"
                    : lastPushAt
                      ? `Последний: ${new Date(lastPushAt).toLocaleString("ru-RU")}`
                      : "Ещё не было"}
                </div>
              </div>
              <button
                onClick={async () => {
                  if (pendingCount === 0) return;
                  const ok = confirm(
                    `Отправить ${pendingCount} локальных правок в Дзен-мани?\n\nЕсли auto-снимок не был сделан недавно, он будет создан перед отправкой.`
                  );
                  if (!ok) return;
                  try {
                    await pushPendingEdits();
                  } catch {
                    /* error already in store */
                  }
                }}
                disabled={busy || pendingCount === 0}
                className="btn-primary !px-3 !py-1 text-xs whitespace-nowrap"
              >
                {isPushing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="w-3.5 h-3.5" />
                )}
                {isPushing ? "..." : "Push"}
              </button>
            </div>
          ) : (
            <div className="text-xs text-muted py-2 border-t border-border/40">
              Push в облако выключен —{" "}
              <Link
                to="/import"
                onClick={() => setOpen(false)}
                className="text-accent hover:underline"
              >
                включить в настройках
              </Link>
              .
            </div>
          )}

          {pushError && (
            <div className="text-xs text-expense mt-2 pt-2 border-t border-border/40">
              {pushError}
            </div>
          )}
          {pushStatus === "ok" && lastPushResult && lastPushResult.pushed > 0 && (
            <div className="text-xs text-income mt-2 pt-2 border-t border-border/40">
              Отправлено: <strong>{lastPushResult.pushed}</strong>
              {lastPushResult.skipped.length > 0 && (
                <>
                  {" · "}пропущено: {lastPushResult.skipped.length}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
