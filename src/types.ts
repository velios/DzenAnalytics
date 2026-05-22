export type Currency = "RUB" | "USD" | "CNY" | "TRY" | string;

/**
 * Kinds of money movement we track.
 *
 *   • expense  — money out, classifies into expense KPIs and category totals.
 *   • income   — money in, classifies into income KPIs.
 *   • transfer — between two of the user's own accounts, neutral on net.
 *   • refund   — money back from a previous expense (returned purchase,
 *                cashback within an expense category, etc.). Renders as
 *                an inflow on the account, but aggregates as a *negative
 *                expense* on the original category — i.e. it shrinks the
 *                category's spend, never inflates income totals.
 *                Zenmoney encodes refunds as `income > 0` transactions
 *                tagged with an *expense* category (a tag whose
 *                `showOutcome` flag is on). See `zenmoneyMap.ts`.
 */
export type TxKind = "expense" | "income" | "transfer" | "refund";

export interface RawRow {
  date: string;
  categoryName: string;
  payee: string;
  comment: string;
  outcomeAccountName: string;
  outcome: string;
  outcomeCurrencyShortTitle: string;
  incomeAccountName: string;
  income: string;
  incomeCurrencyShortTitle: string;
  createdDate: string;
  changedDate: string;
  qrCode: string;
}

export interface Transaction {
  id: string;
  date: string;
  category: string;
  subcategory: string | null;
  categoryFull: string;
  categoryOriginal?: string;
  subcategoryOriginal?: string | null;
  categoryFullOriginal?: string;
  payee: string;
  payeeOriginal?: string;
  comment: string;
  outcomeAccount: string;
  outcomeAmount: number;
  outcomeCurrency: Currency;
  incomeAccount: string;
  incomeAmount: number;
  incomeCurrency: Currency;
  kind: TxKind;
  amount: number;
  currency: Currency;
  account: string;
  amountBase: number;
  createdAt: string;
}

export interface CurrencyRates {
  base: Currency;
  rates: Record<Currency, number>;
}

export type DataSource = "csv" | "api";

export interface ImportMeta {
  importedAt: string;
  fileName: string;
  totalRows: number;
  parsed: number;
  skipped: number;
  /** Where this data came from. CSV-imported and API-synced datasets are mutually exclusive. */
  source?: DataSource;
}
