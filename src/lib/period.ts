/**
 * Reporting-period helpers.
 *
 * Many people don't think of a "month" as 1st–31st but as a billing
 * window — e.g. salary on the 11th, so 11th → 10th of the next month
 * is their reporting period. These helpers let aggregations and filters
 * speak in terms of a configurable `startDay` (1–28).
 *
 * Convention: a period is identified by the `YYYY-MM` string of its
 * START month. So period `2026-05` with `startDay=11` spans
 * `11/05/2026 → 10/06/2026`. Period `2026-05` with `startDay=1` (the
 * default) collapses to plain calendar May — every helper here returns
 * the same result as the old calendar-month code path, so callers that
 * don't pass `startDay` keep working unchanged.
 *
 * Reasoning behind 28-day max: 29/30/31 don't exist in every month and
 * would make some periods ambiguous. The UI also caps the picker at 28
 * for the same reason.
 */

/**
 * Which billing period does this date fall into?
 *
 * Returns the period identifier as `YYYY-MM` of the period's START month.
 * If the date's day-of-month is ≥ `startDay`, the period started this
 * calendar month. Otherwise it started last calendar month.
 *
 * @example
 *   periodKey("2026-05-15", 11) // "2026-05"  (within 11/05 → 10/06)
 *   periodKey("2026-05-05", 11) // "2026-04"  (still within 11/04 → 10/05)
 *   periodKey("2026-05-15", 1)  // "2026-05"  (plain calendar month)
 */
export function periodKey(isoDate: string, startDay: number = 1): string {
  const [yStr, mStr, dStr] = isoDate.slice(0, 10).split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (d >= startDay) {
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  const prev = new Date(y, m - 2, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Calendar-date range of the billing period identified by `ym`.
 *
 * @example
 *   periodRange("2026-05", 11) // { from: "2026-05-11", to: "2026-06-10" }
 *   periodRange("2026-05", 1)  // { from: "2026-05-01", to: "2026-05-31" }
 */
export function periodRange(
  ym: string,
  startDay: number = 1
): { from: string; to: string } {
  const [yStr, mStr] = ym.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const start = new Date(y, m - 1, startDay);
  // Day before the next period starts = last day of this period.
  const end = new Date(y, m, startDay - 1);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: fmt(start), to: fmt(end) };
}

/**
 * The billing period that today's date falls into.
 *
 * Accepts an optional `today` for tests / deterministic snapshots.
 */
export function currentPeriod(
  startDay: number = 1,
  today: Date = new Date()
): string {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const d = today.getDate();
  if (d >= startDay) {
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  const prev = new Date(y, m - 2, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Shift a period identifier by N billing months. Internally the same as
 * shifting the start-month index — billing-period strings stay sortable
 * lexicographically and step by exactly one calendar month at a time.
 */
export function shiftPeriod(ym: string, delta: number): string {
  const [yStr, mStr] = ym.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
