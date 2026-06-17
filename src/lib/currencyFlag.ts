// Map an ISO-4217 currency code to the 2-letter country/region whose flag
// represents it. Most codes are «country prefix + currency letter» (USD→US),
// but plenty aren't (EUR→EU, GBP→GB), and crypto/metals have no country — so a
// curated table is safer than blindly taking the first two letters (which would
// turn BTC into 🇧🇹 Bhutan).
const CURRENCY_COUNTRY: Record<string, string> = {
  RUB: "RU", USD: "US", EUR: "EU", GBP: "GB", JPY: "JP", CNY: "CN", CHF: "CH",
  // CIS / neighbours — common for Дзен-мани users.
  KZT: "KZ", UAH: "UA", BYN: "BY", GEL: "GE", AMD: "AM", AZN: "AZ", UZS: "UZ",
  KGS: "KG", TJS: "TJ", TMT: "TM", MDL: "MD",
  // Europe.
  TRY: "TR", PLN: "PL", CZK: "CZ", HUF: "HU", RON: "RO", BGN: "BG", RSD: "RS",
  SEK: "SE", NOK: "NO", DKK: "DK", ISK: "IS",
  // Middle East / Asia / Americas / Oceania / Africa.
  ILS: "IL", AED: "AE", SAR: "SA", QAR: "QA", INR: "IN", THB: "TH", HKD: "HK",
  SGD: "SG", KRW: "KR", IDR: "ID", MYR: "MY", PHP: "PH", VND: "VN", TWD: "TW",
  AUD: "AU", NZD: "NZ", CAD: "CA", BRL: "BR", MXN: "MX", ARS: "AR", CLP: "CL",
  ZAR: "ZA", EGP: "EG",
};

/**
 * Flag emoji for a currency, or null when there's no country flag for it
 * (crypto, precious metals, unknown codes) — the caller renders a fallback.
 */
export function currencyFlagEmoji(code: string): string | null {
  const cc = CURRENCY_COUNTRY[code.trim().toUpperCase()];
  if (!cc) return null;
  return String.fromCodePoint(
    ...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}
