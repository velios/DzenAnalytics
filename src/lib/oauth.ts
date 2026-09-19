import { closeDB } from "./db";

const BROKER_URL = import.meta.env.VITE_TOKEN_BROKER_URL;
const ATTEMPT_KEY = "dzenanalyticsOAuthAttempt";

export function isOAuthConfigured(): boolean {
  return !!BROKER_URL;
}

export function startOAuth(): void {
  if (!BROKER_URL) return;
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const state = `dzenanalytics:${nonce}`;
  sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({ state, expiresAt: Date.now() + 600_000 }));
  const url = new URL("/auth", BROKER_URL);
  url.searchParams.set("state", state);
  location.assign(url.href);
}

// Read and clear before mounting the router or starting background sync.
export function consumeOAuthCallback(): { code: string } | { error: true } | null {
  if (!BROKER_URL || location.pathname !== "/oauth/callback") return null;
  const params = new URLSearchParams(location.search);
  history.replaceState(null, "", "/settings?source=api");
  const pending = sessionStorage.getItem(ATTEMPT_KEY);
  sessionStorage.removeItem(ATTEMPT_KEY);
  try {
    const attempt = JSON.parse(pending ?? "null");
    if (!attempt || typeof attempt.state !== "string" || !(attempt.expiresAt > Date.now()) ||
      params.getAll("state").length !== 1 || params.get("state") !== attempt.state ||
      params.has("error") || params.getAll("code").length !== 1 || !params.get("code")) return { error: true };
    return { code: params.get("code")! };
  } catch {
    return { error: true };
  }
}

export async function exchangeCode(code: string): Promise<string> {
  if (!BROKER_URL) throw new Error("OAuth is not configured");
  const response = await fetch(new URL("/exchange", BROKER_URL), {
    method: "POST", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Не удалось завершить вход. Попробуйте снова.");
  const result = await response.json();
  if (typeof result?.accessToken !== "string" || !result.accessToken) throw new Error("Некорректный ответ входа");
  return result.accessToken;
}

export function shouldWipeForUser(cachedId: number | null, tokenId: number | null): boolean {
  return cachedId != null && tokenId != null && tokenId !== cachedId;
}

export async function wipeLocalDb(): Promise<void> {
  closeDB();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("dzenanalytics");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error("Не удалось очистить локальные данные"));
    request.onblocked = () => reject(new Error("Закройте другие вкладки DzenAnalytics и повторите вход"));
  });
}
