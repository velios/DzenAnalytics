import { Loader2 } from "lucide-react";
import { useDataStore } from "../store/useDataStore";

/**
 * Small fixed chip shown while CBR historical rates are warming in the
 * background. Analytics already render (at sync-time rates) and snap to the
 * historical values once this finishes — the chip just explains the brief
 * shift. Idle → renders nothing.
 */
export function HistRatesProgress() {
  const warming = useDataStore((s) => s.histWarming);
  if (!warming) return null;
  const { done, total } = warming;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2.5 rounded-lg border border-border bg-panel shadow-lg px-3 py-2 text-xs text-text"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" aria-hidden />
      <div className="flex flex-col leading-tight">
        <span>Загружаю курсы ЦБ на даты операций</span>
        <span className="text-muted tabular-nums">
          {done} / {total} ({pct}%)
        </span>
      </div>
    </div>
  );
}
