// Zenmoney account `type` → short Russian label. Shared by the dashboard
// balances table and the Accounts page so the wording stays identical.

export const ACCOUNT_TYPE_RU: Record<string, string> = {
  ccard: "Карта",
  debit: "Карта",
  checking: "Счёт",
  cash: "Наличные",
  deposit: "Вклад",
  loan: "Долг",
  credit: "Долг",
  debt: "Долг",
  emoney: "Кошелёк",
};

export function accountTypeLabel(type: string): string {
  if (!type) return "—";
  return ACCOUNT_TYPE_RU[type] || type;
}
