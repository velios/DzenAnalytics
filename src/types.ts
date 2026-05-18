export type Currency = "RUB" | "USD" | "CNY" | "TRY" | string;

export type TxKind = "expense" | "income" | "transfer";

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
