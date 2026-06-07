import type { InputHTMLAttributes } from "react";

/**
 * A native `<input type="date">` with a Russian placeholder.
 *
 * Chrome renders the empty-state format ("dd.mm.yyyy") from the *browser*
 * locale, not the page's `lang`, so it can't be localised directly. We
 * therefore hide the native placeholder (CSS makes `::-webkit-datetime-edit`
 * transparent while empty + unfocused) and overlay our own "дд.мм.гггг".
 * The native field reappears on focus (so keyboard entry stays visible) and
 * once a value is set. The calendar-picker icon is untouched.
 *
 * Drop-in for `<input type="date" className=… value=… onChange=… />`.
 * Width/layout classes that must live on the box (e.g. `w-36` for a fixed
 * width) go in `wrapperClassName`; the input itself is `w-full`.
 */
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
  const empty = value === "" || value === undefined || value === null;
  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        type="date"
        value={value}
        className={`${className} ${empty ? "date-empty" : ""}`}
        {...rest}
      />
      {empty && <span className="date-ph">{placeholder || "дд.мм.гггг"}</span>}
    </div>
  );
}
