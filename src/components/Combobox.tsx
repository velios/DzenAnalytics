import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface ComboboxProps {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  /** Max popup height in CSS — defaults to "min(50vh, 320px)". */
  maxHeight?: string;
  /** If false, free-form typing is disabled (only listed options allowed). */
  allowCustom?: boolean;
}

/**
 * Text input + filterable dropdown. Replaces native <select>/<datalist>
 * because neither gives us:
 *   - Clicking the chevron OR clicking on a populated field opens the list
 *     (user doesn't need to clear the field to pick a different option).
 *   - A bounded popup height: list caps at ~50vh by default, never the
 *     whole viewport.
 *   - Free-form input (configurable via `allowCustom`).
 */
export function Combobox({
  value,
  options,
  onChange,
  placeholder,
  maxHeight = "min(50vh, 320px)",
  allowCustom = true,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  // Filter only when the user has actively typed *after* opening (clicking the
  // chevron on a populated field should reveal ALL options, not just matches
  // for the current value).
  const [filtering, setFiltering] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync input when value updates externally.
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Close when the user clicks outside.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const filtered = useMemo(() => {
    if (!filtering) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [filtering, query, options]);

  function commit(next: string) {
    setQuery(next);
    onChange(next);
    setFiltering(false);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => {
            if (!allowCustom) return;
            setQuery(e.target.value);
            onChange(e.target.value);
            setFiltering(true);
            if (!open) setOpen(true);
          }}
          readOnly={!allowCustom}
          onFocus={() => {
            setFiltering(false);
            setOpen(true);
          }}
          onClick={() => {
            setFiltering(false);
            setOpen(true);
          }}
          placeholder={placeholder}
          className={`input text-sm w-full pr-7 ${!allowCustom ? "cursor-pointer" : ""}`}
        />
        <button
          type="button"
          onMouseDown={(e) => {
            // mouseDown so the toggle wins over input blur.
            e.preventDefault();
            setFiltering(false);
            setOpen((v) => !v);
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
          tabIndex={-1}
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {open && filtered.length > 0 && (
        <div
          className="absolute z-10 mt-1 w-full bg-panel border border-border rounded-lg shadow-lg overflow-y-auto"
          style={{ maxHeight }}
        >
          {filtered.map((opt) => {
            const isCurrent = opt === value;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => commit(opt)}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-panel2 ${
                  isCurrent ? "bg-panel2/60 text-accent" : ""
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
