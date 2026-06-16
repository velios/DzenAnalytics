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
const LOGOUT_URL = import.meta.env.VITE_LOGOUT_URL;

/** True when the build wired up a token provider. */
export function isProviderActive(): boolean {
  return !!PROVIDER_URL;
}

/**
 * True when the build wired up an SSO logout endpoint. Without it the
 * frontend can only do a *local* disconnect (opt-out) — it cannot end the
 * server-side session, because the session cookie is HttpOnly / cross-origin.
 */
export function isLogoutConfigured(): boolean {
  return !!LOGOUT_URL;
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
 * Whether boot should silently pull the SSO token. Only when the build wired
 * a provider, there's no manual token, AND the user hasn't explicitly
 * disconnected (opt-out). The opt-out is the thing that breaks the "I cleared
 * everything but it reconnects on reload" loop: a live SSO cookie alone must
 * NOT re-adopt the session after a deliberate disconnect — clearing local
 * state can't kill a server-side / cross-origin session cookie, so the user
 * needs a local "stop auto-connecting" flag instead.
 */
export function shouldAutoConnectProvider(
  providerActive: boolean,
  hasManualToken: boolean,
  optedOut: boolean
): boolean {
  return providerActive && !hasManualToken && !optedOut;
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
 * End the server-side SSO session via the logout endpoint (POST, cookie sent
 * with `credentials:"include"`). Returns true only on an explicit `{ok:true}`
 * — anything else (a same-origin SPA fallback returning HTML, a non-2xx, a
 * network error) counts as failure, so the UI never fakes a logout the server
 * didn't actually perform. The local opt-out / token reset is the caller's job
 * (store), same split as `redirectToLogin`. No-op (false) when no logout
 * endpoint was wired.
 */
export async function postLogout(): Promise<boolean> {
  if (!LOGOUT_URL) return false;
  try {
    const res = await fetch(LOGOUT_URL, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return false;
    const j = (await res.json()) as { ok?: boolean };
    return j.ok === true;
  } catch {
    return false;
  }
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
