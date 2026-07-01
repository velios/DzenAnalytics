type Kind = "expense" | "income";

/**
 * Segmented pill slider for «Расходы» ⇄ «Доходы», styled like the theme
 * switcher: a neutral thumb slides under the active side, whose label takes the
 * kind's colour (red for expense, green for income). Replaces the old top-right
 * pill toggle AND the static kind badge in the Categories header.
 */
export function KindSwitcher({
  kind,
  onChange,
}: {
  kind: Kind;
  onChange: (k: Kind) => void;
}) {
  const isIncome = kind === "income";
  return (
    <div className="relative inline-flex h-7 items-center rounded-full bg-panel2 border border-border p-0.5 text-xs font-medium select-none shrink-0">
      <span
        aria-hidden
        className="absolute top-0.5 bottom-0.5 left-0.5 w-[76px] rounded-full bg-bg shadow border border-border transition-transform duration-200 ease-out"
        style={{ transform: isIncome ? "translateX(76px)" : "translateX(0)" }}
      />
      <button
        type="button"
        onClick={() => onChange("expense")}
        aria-pressed={!isIncome}
        className={`relative z-10 w-[76px] h-6 rounded-full transition-colors ${
          !isIncome ? "text-expense" : "text-muted hover:text-text"
        }`}
      >
        Расходы
      </button>
      <button
        type="button"
        onClick={() => onChange("income")}
        aria-pressed={isIncome}
        className={`relative z-10 w-[76px] h-6 rounded-full transition-colors ${
          isIncome ? "text-income" : "text-muted hover:text-text"
        }`}
      >
        Доходы
      </button>
    </div>
  );
}
