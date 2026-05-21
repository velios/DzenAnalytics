/**
 * Bank brand registry — used by `<AccountLogo>` to render a recognisable
 * coloured monogram next to each account.
 *
 * We deliberately do NOT bundle the banks' actual logos. Each entry stores:
 *   • a regex set that matches the account title (works in both API and
 *     CSV mode — we don't depend on `company.id` because CSV exports
 *     never include it);
 *   • the bank's public brand colour (factual info — printed on their
 *     cards, website, in their identity guidelines);
 *   • a short monogram (1–3 chars) to render on top of the colour.
 *
 * If you want a real logo for a particular bank, drop a single SVG into
 * `src/assets/bank-logos/<slug>.svg` — the `<AccountLogo>` component
 * auto-discovers it via `import.meta.glob` and prefers it over the
 * coloured-monogram fallback. The slug is the entry's `slug` field below.
 *
 * Ordering matters: first match wins. Put narrower patterns (e.g.
 * "Альфа KZ") above broader ones ("Альфа").
 */
export interface BankBrand {
  /** Slug for the optional SVG override (`src/assets/bank-logos/<slug>.svg`). */
  slug: string;
  /** Patterns matched against account/company title (case-insensitive). */
  patterns: RegExp[];
  /** Background colour for the monogram badge. */
  color: string;
  /** Foreground (text) colour for the monogram. */
  fg: string;
  /** 1–3 character monogram shown on the badge. */
  monogram: string;
  /** Display name for tooltip / a11y. */
  name: string;
}

export const BANK_REGISTRY: BankBrand[] = [
  // ===== RU: top retail banks =====
  { slug: "sber",        patterns: [/^сбер/i, /sber/i, /сбербанк/i],           color: "#21A038", fg: "#FFFFFF", monogram: "С",   name: "Сбер" },
  { slug: "tbank",       patterns: [/т-?банк/i, /tinkoff/i, /тинькофф/i, /\btcs\b/i], color: "#FFDD2D", fg: "#000000", monogram: "Т", name: "Т-Банк" },
  { slug: "vtb",         patterns: [/\bвтб/i, /\bvtb/i, /vb24/i],              color: "#0A2973", fg: "#FFFFFF", monogram: "ВТ",  name: "ВТБ" },
  { slug: "alfa",        patterns: [/альфа[\s-]?банк/i, /alfa[\s-]?bank/i, /\balpha\b/i], color: "#EF3124", fg: "#FFFFFF", monogram: "А", name: "Альфа-Банк" },
  { slug: "gazprombank", patterns: [/газпром(банк)?/i, /\bgpb\b/i, /gazprom/i], color: "#2E5BB8", fg: "#FFFFFF", monogram: "ГП", name: "Газпромбанк" },
  { slug: "rshb",        patterns: [/россельхоз/i, /\brshb\b/i],                color: "#0E712C", fg: "#FFFFFF", monogram: "РС", name: "Россельхозбанк" },
  { slug: "otkritie",    patterns: [/открытие/i, /otkritie/i],                  color: "#1AAEA9", fg: "#FFFFFF", monogram: "От", name: "Открытие" },
  { slug: "sovcom",      patterns: [/совком/i, /sovcom/i, /халва/i, /halva/i], color: "#FF6600", fg: "#FFFFFF", monogram: "Сов", name: "Совкомбанк" },
  { slug: "rosbank",     patterns: [/росбанк/i, /rosbank/i],                    color: "#C00021", fg: "#FFFFFF", monogram: "Р", name: "Росбанк" },
  { slug: "mkb",         patterns: [/мкб/i, /московский\s+кредитный/i],         color: "#0D2D5C", fg: "#FFFFFF", monogram: "МКБ", name: "МКБ" },
  { slug: "psb",         patterns: [/псб/i, /промсвязь/i, /psbank/i],           color: "#FF6900", fg: "#FFFFFF", monogram: "ПСБ", name: "ПСБ" },
  { slug: "unicredit",   patterns: [/юникредит/i, /unicredit/i],                color: "#E2001A", fg: "#FFFFFF", monogram: "UC", name: "ЮниКредит" },
  { slug: "raiffeisen",  patterns: [/райфф?айзен/i, /raiff?eisen/i, /r[-\s]?online/i], color: "#FEE600", fg: "#000000", monogram: "Р", name: "Райффайзен" },
  { slug: "otp",         patterns: [/^отп(?:\s|$)/i, /\botp\b/i, /^otp\s+bank/i], color: "#6CA938", fg: "#FFFFFF", monogram: "ОТП", name: "ОТП Банк" },
  { slug: "homecredit",  patterns: [/хоум\s?кредит/i, /home\s?credit/i],        color: "#DC0029", fg: "#FFFFFF", monogram: "ХК", name: "Хоум Кредит" },
  { slug: "mtsbank",     patterns: [/мтс[\s-]?банк/i, /mts[\s-]?bank/i],        color: "#E30613", fg: "#FFFFFF", monogram: "МТС", name: "МТС Банк" },
  { slug: "yoomoney",    patterns: [/ю[\s-]?money/i, /yoo?money/i, /яндекс\.?\s?деньги/i], color: "#8B3FFD", fg: "#FFFFFF", monogram: "Ю", name: "ЮMoney" },
  { slug: "bspb",        patterns: [/банк\s+санкт[\s-]петербург/i, /\bbspb\b/i, /бспб/i], color: "#006FCF", fg: "#FFFFFF", monogram: "БС", name: "Банк Санкт-Петербург" },
  { slug: "tochka",      patterns: [/^точка(?:\s|$)/i, /\btochka\b/i],          color: "#1F1F1F", fg: "#FFFFFF", monogram: "Т·", name: "Точка" },
  { slug: "ozonbank",    patterns: [/^ozon(?:\s|$|банк|bank)/i, /озон[\s-]?банк/i], color: "#005BFF", fg: "#FFFFFF", monogram: "O", name: "Озон Банк" },
  { slug: "wildberries", patterns: [/^wb(?:\s|$|кошел)/i, /wildberries/i, /\bвб\b/i, /вайлдберр/i], color: "#CB11AB", fg: "#FFFFFF", monogram: "WB", name: "Wildberries" },
  { slug: "yandex",      patterns: [/^яндекс/i, /^yandex/i],                    color: "#FFCC00", fg: "#000000", monogram: "Я", name: "Яндекс" },
  { slug: "ffin",        patterns: [/\bffin\b/i, /freedom\s?finance/i, /финам/i, /\bfinam\b/i], color: "#00713B", fg: "#FFFFFF", monogram: "F", name: "Freedom Finance" },
  { slug: "bcs",         patterns: [/^бкс/i, /\bbcs\b/i],                       color: "#FFCC00", fg: "#000000", monogram: "БКС", name: "БКС" },
  { slug: "uralsib",     patterns: [/уралсиб/i, /uralsib/i],                    color: "#1F4FA7", fg: "#FFFFFF", monogram: "У", name: "Уралсиб" },
  { slug: "akbars",      patterns: [/ак\s?барс/i, /ak\s?bars/i],                color: "#007749", fg: "#FFFFFF", monogram: "АБ", name: "АК БАРС" },
  { slug: "avangard",    patterns: [/^авангард/i, /avangard/i],                 color: "#003366", fg: "#FFFFFF", monogram: "Ав", name: "Авангард" },
  { slug: "zenit",       patterns: [/^зенит/i, /zenit/i],                       color: "#003C7E", fg: "#FFFFFF", monogram: "З", name: "Зенит" },
  { slug: "citi",        patterns: [/\bciti(?:bank)?\b/i, /сити(?:банк)?/i],   color: "#1C4F9C", fg: "#FFFFFF", monogram: "Ci", name: "Citibank" },
  { slug: "abr",         patterns: [/абсолют[\s-]?банк/i, /absolut[\s-]?bank/i], color: "#2554A5", fg: "#FFFFFF", monogram: "Аб", name: "Абсолют Банк" },
  { slug: "rosselh",     patterns: [/\brosselkhoz/i],                            color: "#0E712C", fg: "#FFFFFF", monogram: "РС", name: "Россельхозбанк" },
  { slug: "tkb",         patterns: [/транскапитал/i, /\btkb\b/i],                color: "#003F7C", fg: "#FFFFFF", monogram: "ТКБ", name: "Транскапиталбанк" },
  { slug: "lokobank",    patterns: [/локо[\s-]?банк/i, /loko[\s-]?bank/i],     color: "#005BBB", fg: "#FFFFFF", monogram: "Л", name: "Локо-Банк" },
  { slug: "atb",         patterns: [/азиатско[\s-]тихоок/i, /\batb\b/i],         color: "#003366", fg: "#FFFFFF", monogram: "АТБ", name: "АТБ" },
  { slug: "domrf",       patterns: [/дом\.?\s?рф/i, /dom\.?\s?rf/i],            color: "#0033A1", fg: "#FFFFFF", monogram: "ДРФ", name: "Дом.РФ" },
  { slug: "sovcom-bank", patterns: [/совком(?:банк)?/i],                         color: "#FF6600", fg: "#FFFFFF", monogram: "СК", name: "Совкомбанк" },
  { slug: "qiwi",        patterns: [/qiwi/i, /киви/i],                           color: "#FA9300", fg: "#FFFFFF", monogram: "Q", name: "QIWI" },
  { slug: "webmoney",    patterns: [/webmoney/i, /вебмани/i],                    color: "#1C7BD8", fg: "#FFFFFF", monogram: "WM", name: "WebMoney" },
  { slug: "yandex-pay",  patterns: [/яндекс[\s.]?(pay|плюс|плати)/i, /yandex[\s.]?pay/i], color: "#FFCC00", fg: "#000000", monogram: "Я+", name: "Yandex Pay" },
  { slug: "ininal",      patterns: [/ininal/i],                                  color: "#1B1B1B", fg: "#FFFFFF", monogram: "in", name: "Ininal" },
  { slug: "tg-wallet",   patterns: [/tg[\s-]?wallet/i, /telegram[\s-]?(wallet|кошел)/i, /^tg(?:\s|$)/i], color: "#229ED9", fg: "#FFFFFF", monogram: "TG", name: "TG Wallet" },
  { slug: "cash-rub",    patterns: [/^наличные/i, /^cash(?:\s|$)/i],             color: "#475569", fg: "#FFFFFF", monogram: "₽",  name: "Наличные" },

  // ===== KZ: top 10 banks =====
  { slug: "kaspi",       patterns: [/каспи/i, /kaspi/i],                         color: "#F14635", fg: "#FFFFFF", monogram: "К", name: "Kaspi Bank" },
  { slug: "halyk",       patterns: [/халык/i, /halyk/i, /народный\s+банк/i],    color: "#00A04E", fg: "#FFFFFF", monogram: "Н", name: "Halyk Bank" },
  { slug: "forte",       patterns: [/forte[\s-]?bank/i, /форте/i],               color: "#007A4D", fg: "#FFFFFF", monogram: "F", name: "ForteBank" },
  { slug: "jusan",       patterns: [/jusan/i, /цеснабанк/i, /tsesna/i],          color: "#1E2A78", fg: "#FFFFFF", monogram: "J", name: "Jusan Bank" },
  { slug: "bcc",         patterns: [/центркредит/i, /\bbcc\b/i, /bank\s?center\s?credit/i], color: "#00305A", fg: "#FFFFFF", monogram: "ЦК", name: "Bank CenterCredit" },
  { slug: "eubank",      patterns: [/евразийск(ий)?\s+банк/i, /\beubank\b/i],   color: "#C8102E", fg: "#FFFFFF", monogram: "ЕВ", name: "Евразийский Банк" },
  { slug: "bereke",      patterns: [/bereke/i, /береке/i],                       color: "#003C71", fg: "#FFFFFF", monogram: "Б", name: "Bereke Bank" },
  { slug: "rbk",         patterns: [/bank\s?rbk/i, /рбк[\s-]?банк/i],            color: "#00B388", fg: "#FFFFFF", monogram: "RBK", name: "Bank RBK" },
  { slug: "homecredit-kz", patterns: [/хоум\s?кредит\s?kz/i, /home\s?credit\s?kz/i], color: "#DC0029", fg: "#FFFFFF", monogram: "ХК", name: "Хоум Кредит KZ" },
  { slug: "freedom-kz",  patterns: [/freedom\s?(finance|bank)?\s?kz/i, /freedom\s?bank/i], color: "#00713B", fg: "#FFFFFF", monogram: "F", name: "Freedom Bank KZ" },
];

/**
 * Find the brand entry that matches a given account/company title.
 * Returns `null` if nothing matches — caller should fall back to a
 * generic initial-on-colour avatar.
 */
export function resolveBrand(title: string | null | undefined): BankBrand | null {
  if (!title) return null;
  const t = title.trim();
  if (!t) return null;
  for (const b of BANK_REGISTRY) {
    if (b.patterns.some((p) => p.test(t))) return b;
  }
  return null;
}
