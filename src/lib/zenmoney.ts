// Zenmoney API client.
//
// API docs: https://github.com/zenmoney/ZenPlugins/wiki/ZenMoney-API
// Single endpoint POST /v8/diff/ returns ALL data (transactions, accounts,
// tags, instruments, etc.) in one response. `serverTimestamp` enables
// incremental sync — for now we always do full sync (serverTimestamp=0).
//
// Token is the user's personal access token, stored in IndexedDB and sent
// as Bearer header. CORS is open (Access-Control-Allow-Origin: *), so this
// works directly from the browser, including file:// origins.

const API_BASE = "https://api.zenmoney.ru";

export interface ZenInstrument {
  id: number;
  title: string;
  shortTitle: string;
  symbol: string;
  rate: number; // 1 unit of this instrument = `rate` RUB
}

export interface ZenAccount {
  id: string;
  user: number;
  instrument: number;
  type: string;          // ccard / debit / cash / loan / deposit / checking / credit / ...
  role: number | null;
  private: boolean;
  savings: boolean;
  title: string;
  inBalance: boolean;
  archive: boolean;
  balance: number;
  startBalance: number;
  startDate: string | null;
  creditLimit: number;
  syncID: string[] | null;
  changed: number;
}

export interface ZenTag {
  id: string;
  user: number;
  title: string;
  parent: string | null;
  archive: boolean;
  showIncome: boolean;
  showOutcome: boolean;
  budgetIncome: boolean;
  budgetOutcome: boolean;
  icon: string | null;
  color: number | null;
  changed: number;
}

export interface ZenMerchant {
  id: string;
  user: number;
  title: string;
  changed: number;
}

export interface ZenTransaction {
  id: string;
  user: number;
  date: string;          // YYYY-MM-DD
  income: number;
  outcome: number;
  changed: number;
  incomeInstrument: number;
  outcomeInstrument: number;
  created: number;
  originalPayee: string | null;
  deleted: boolean;
  viewed: boolean;
  hold: boolean | null;
  qrCode: string | null;
  source: string | null;
  incomeAccount: string;
  outcomeAccount: string;
  tag: string[] | null;
  comment: string | null;
  payee: string | null;
  opIncome: number | null;
  opOutcome: number | null;
  opIncomeInstrument: number | null;
  opOutcomeInstrument: number | null;
  latitude: number | null;
  longitude: number | null;
  merchant: string | null;
  incomeBankID: string | null;
  outcomeBankID: string | null;
  reminderMarker: string | null;
}

export interface ZenDeletion {
  id: string;
  object: string;        // "transaction" | "account" | "tag" | ...
  user: number;
  stamp: number;
}

export interface ZenDiffResponse {
  serverTimestamp: number;
  instrument: ZenInstrument[];
  account: ZenAccount[];
  tag: ZenTag[];
  merchant: ZenMerchant[];
  transaction: ZenTransaction[];
  user: { id: number; currency: number; [k: string]: unknown }[];
  budget?: unknown[];
  reminder?: unknown[];
  reminderMarker?: unknown[];
  country?: unknown[];
  company?: unknown[];
  deletion?: ZenDeletion[];
}

export class ZenApiError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ZenApiError";
  }
}

interface DiffRequest {
  currentClientTimestamp: number;
  serverTimestamp: number;
  // forceFetch?: string[]; // optional, e.g. ["transaction"] to bypass diff caching
}

/**
 * Calls POST /v8/diff/ with the given token and serverTimestamp.
 * Returns the full response (transactions + all reference entities).
 * Throws ZenApiError on non-2xx responses.
 */
export async function fetchDiff(
  token: string,
  serverTimestamp = 0,
  signal?: AbortSignal
): Promise<ZenDiffResponse> {
  const body: DiffRequest = {
    currentClientTimestamp: Math.floor(Date.now() / 1000),
    serverTimestamp,
  };
  const res = await fetch(`${API_BASE}/v8/diff/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let code: string | null = null;
    try {
      const j = (await res.json()) as { error?: { message?: string; code?: string } };
      if (j.error?.message) msg = j.error.message;
      if (j.error?.code) code = j.error.code;
    } catch {
      // ignore parse errors — keep the HTTP-status fallback
    }
    throw new ZenApiError(msg, res.status, code);
  }
  return (await res.json()) as ZenDiffResponse;
}

/**
 * Lightweight token check — sends a diff with serverTimestamp=now so the
 * response payload is small. Returns true on 2xx, false on 401, throws on
 * other errors.
 */
export async function checkToken(token: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  try {
    await fetchDiff(token, now);
    return true;
  } catch (e) {
    if (e instanceof ZenApiError && e.status === 401) return false;
    throw e;
  }
}
