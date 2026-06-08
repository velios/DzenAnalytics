import type { InputHTMLAttributes } from "react";
import { Calendar } from "lucide-react";

/**
 * A date field with a fully Russian display.
 *
 * Chrome renders <input type="date"> from the *browser* locale, so its
 * "dd.mm.yyyy" placeholder (and the highlighted segment on focus) can't be
 * localised by CSS without the English bleeding through. Instead of fighting
 * that, we make the native input invisible (opacity 0) — it still receives
 * clicks, holds the value and opens the calendar picker — and paint our OWN
 * layer on top: either the formatted value "дд.мм.гггг" or the placeholder.
 * No native text is ever shown, so nothing can flash or overlap.
 *
 * Drop-in for `<input type="date" value=… onChange=… className=… />`;
 * onChange still receives a normal change event (`e.target.value` = ISO).
 * Width/layout that must size the box goes in `wrapperClassName`.
 */
function toDDMMYYYY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  wrapperClassName?: string;
}

export function DateField({
  className = "",
  wrapperClassName = "",
  placeholder,
  value,
  ...rest
}: Props) {
  const iso = typeof value === "string" ? value : "";
  const display = iso ? toDDMMYYYY(iso) : "";
  const ph = typeof placeholder === "string" ? placeholder : "дд.мм.гггг";

  return (
    <div className={`relative ${wrapperClassName}`}>
      {/* The real control — invisible, on top, so it gets the clicks. */}
      <input
        type="date"
        value={value}
        {...rest}
        onClick={(e) => {
          // Open the native picker on any click — keyboard typing of a
          // date input is segment-based and not the primary flow here.
          try {
            e.currentTarget.showPicker?.();
          } catch {
            /* showPicker needs user activation / may already be open */
          }
        }}
        aria-label={typeof placeholder === "string" ? placeholder : "Дата"}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
      />
      {/* Our visible layer — pure Russian, never shows native text. */}
      <div
        aria-hidden
        className={`${className} flex items-center justify-between gap-2 peer-focus:border-accent`}
      >
        <span className={`truncate ${display ? "" : "text-muted"}`}>
          {display || ph}
        </span>
        <Calendar className="w-4 h-4 shrink-0 text-muted" />
      </div>
    </div>
  );
}
