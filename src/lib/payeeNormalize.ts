export function normalizePayee(raw: string): string {
  if (!raw) return "";
  let s = raw.trim().toLowerCase();

  s = s.replace(/[#№№]\s*\d+/g, "");
  s = s.replace(/\b\d{4,}\b/g, "");
  s = s.replace(/\b(ip|ooo|ао|оао|зао|пао|ип|ano|llc|ltd|inc|gmbh)\b\.?/gi, "");
  s = s.replace(/\b(magazin|magaz|store|shop|market|kassa|payment|pay)\b/gi, "");
  s = s.replace(/[«»"'`()[\]{}\-_*<>]/g, " ");
  s = s.replace(/[.,;:!?@/\\]/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  s = s.replace(/^(io |тинькофф |тинкофф |t-bank |тб |тбанк |sber |сбер )/i, "");

  return s;
}

export function payeeGroupKey(payee: string): string {
  const norm = normalizePayee(payee);
  if (!norm) return "";
  return norm.split(" ").slice(0, 3).join(" ");
}

export function buildPayeeAliasMap(payees: string[]): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const p of payees) {
    if (!p) continue;
    const key = payeeGroupKey(p);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const out = new Map<string, string>();
  for (const [, variants] of groups) {
    if (variants.length < 2) continue;
    const canonical = variants
      .slice()
      .sort((a, b) => a.length - b.length || a.localeCompare(b, "ru"))[0];
    for (const v of variants) {
      if (v !== canonical) out.set(v, canonical);
    }
  }
  return out;
}
