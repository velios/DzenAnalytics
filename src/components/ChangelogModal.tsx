import { useEffect } from "react";
import { createPortal } from "react-dom";
import { History, X } from "lucide-react";
import { ChangelogView } from "./ChangelogView";

/**
 * Full changelog in a centered modal over a blurred backdrop. Opened from the
 * footer's «Что нового». Content comes from ChangelogView (CHANGELOG.md).
 */
export function ChangelogModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="font-semibold flex items-center gap-2">
            <History className="w-4 h-4 text-accent2" />
            История изменений
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-text"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">
          <ChangelogView />
        </div>
      </div>
    </div>,
    document.body
  );
}
