// Optional external token-provider layer (generic, additive).
//
// When the build sets VITE_TOKEN_PROVIDER_URL the app can obtain its
// Zenmoney access token from an SSO session (cookie) instead of a manually
// pasted token. With the env unset every function is inert and the app
// behaves exactly like upstream (manual token + CSV).
//
// Deliberately generic: this module knows nothing about the surrounding
// ecosystem — only two URLs and the {accessToken} contract. The user-id
// reconcile (what to wipe on a user switch) lives in the store, not here.

import { closeDB } from "./db";

const PROVIDER_URL = import.meta.env.VITE_TOKEN_PROVIDER_URL;
const LOGIN_URL = import.meta.env.VITE_LOGIN_URL;

/** True when the build wired up a token provider. */
export function isProviderActive(): boolean {
  return !!PROVIDER_URL;
}

/**
 * Wipe-on-switch decision. Only wipe when BOTH ids are known and differ —
 * a null on either side means "can't tell", and we must NOT wipe on
 * uncertainty (that would lose data or, worse, never wipe and merge two
 * users' caches). Safety-critical: keep the null-guards.
 */
export function shouldWipeForUser(
  cachedId: number | null,
  tokenId: number | null
): boolean {
  return cachedId != null && tokenId != null && tokenId !== cachedId;
}

/**
 * Fetch the access token for the current session (cookie sent via
 * `credentials: "include"`). Returns the token on 200, or null on 401 /
 * no session / network error — callers treat null uniformly as "no
 * session" (the body's error code, if any, is irrelevant here).
 */
export async function fetchProviderToken(): Promise<string | null> {
  if (!PROVIDER_URL) return null;
  try {
    const res = await fetch(PROVIDER_URL, { credentials: "include" });
    if (!res.ok) return null;
    const j = (await res.json()) as { accessToken?: string };
    return j.accessToken || null;
  } catch {
    return null;
  }
}

/**
 * Send the user to the login / account-switch UI, asking it to return
 * here afterwards. Pure navigation — wipes nothing (see store reconcile,
 * which only acts on the *return* trip when the user id actually changed).
 */
export function redirectToLogin(): void {
  if (!LOGIN_URL) return;
  const u = new URL(LOGIN_URL, location.origin);
  u.searchParams.set("redirect_to", location.href);
  location.href = u.href;
}

/**
 * Drop the entire local IndexedDB and reload. After the reload there is no
 * cache, so startup runs a fresh full sync for the new user. We close our
 * idb handle first so `deleteDatabase` doesn't block on an open connection.
 */
export async function wipeLocalDb(): Promise<void> {
  closeDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("dzenanalytics");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  location.reload();
}
