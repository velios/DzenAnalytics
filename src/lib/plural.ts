// Russian plural for «операция»: 1 операция, 2–4 операции, 5+ операций
// (with the 11–14 exception). Shared by the bulk-edit modal and the
// bulk-action confirms so the wording stays identical.
export function pluralOps(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "операция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "операции";
  return "операций";
}

/**
 * Generic Russian plural picker: `[one, few, many]` for the 1 / 2–4 / 5+
 * forms (with the 11–14 exception). E.g. pluralRu(n, ["правка","правки","правок"]).
 */
export function pluralRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}
