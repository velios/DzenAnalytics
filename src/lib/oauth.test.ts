import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { shouldWipeForUser } from "./oauth";

describe("shouldWipeForUser", () => {
  it("wipes only on a confirmed different user id", () => {
    expect(shouldWipeForUser(1, 2)).toBe(true);
    expect(shouldWipeForUser(1, 1)).toBe(false);
    expect(shouldWipeForUser(null, 2)).toBe(false);
    expect(shouldWipeForUser(1, null)).toBe(false);
  });
});

let currentUrl: URL;
let assigned: string;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_TOKEN_BROKER_URL", "https://broker.example");
  currentUrl = new URL("https://app.example/");
  assigned = "";
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("location", {
    get pathname() { return currentUrl.pathname; },
    get search() { return currentUrl.search; },
    assign: (url: string) => { assigned = url; },
  });
  vi.stubGlobal("history", {
    replaceState: (_state: unknown, _title: string, path: string) => { currentUrl = new URL(path, currentUrl); },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("is inert without configuration", async () => {
  vi.stubEnv("VITE_TOKEN_BROKER_URL", "");
  const oauth = await import("./oauth");
  expect(oauth.isOAuthConfigured()).toBe(false);
  oauth.startOAuth();
  expect(assigned).toBe("");
  expect(oauth.consumeOAuthCallback()).toBeNull();
});

it("consumes a random state once and removes callback parameters before exchanging", async () => {
  const oauth = await import("./oauth");
  oauth.startOAuth();
  const state = new URL(assigned).searchParams.get("state");
  expect(state).toMatch(/^dzenanalytics:[A-Za-z0-9_-]{43}$/);
  expect(assigned).toContain("https://broker.example/auth?");
  const callback = `https://app.example/oauth/callback?state=${state}&code=once`;
  currentUrl = new URL(callback);
  expect(oauth.consumeOAuthCallback()).toEqual({ code: "once" });
  expect(currentUrl.href).toBe("https://app.example/settings?source=api");
  currentUrl = new URL(callback);
  expect(oauth.consumeOAuthCallback()).toEqual({ error: true });
});

it("rejects stale, wrong, duplicate and denied callbacks", async () => {
  const oauth = await import("./oauth");
  for (const extra of ["&state=second", "&code=second", "&error=denied"]) {
    oauth.startOAuth();
    const state = new URL(assigned).searchParams.get("state");
    currentUrl = new URL(`https://app.example/oauth/callback?state=${state}&code=once${extra}`);
    expect(oauth.consumeOAuthCallback()).toEqual({ error: true });
  }
  sessionStorage.setItem("dzenanalyticsOAuthAttempt", JSON.stringify({ state: "expired", expiresAt: 0 }));
  currentUrl = new URL("https://app.example/oauth/callback?state=expired&code=once");
  expect(oauth.consumeOAuthCallback()).toEqual({ error: true });
  oauth.startOAuth();
  currentUrl = new URL("https://app.example/oauth/callback?state=wrong&code=once");
  expect(oauth.consumeOAuthCallback()).toEqual({ error: true });
});

it("exchanges JSON without cookies, redirects or referrer and rejects malformed tokens", async () => {
  const oauth = await import("./oauth");
  const fetchMock = vi.fn().mockResolvedValue(Response.json({accessToken:"synthetic-token"}));
  vi.stubGlobal("fetch", fetchMock);
  expect(await oauth.exchangeCode("once")).toBe("synthetic-token");
  expect(String(fetchMock.mock.calls[0][0])).toBe("https://broker.example/exchange");
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method:"POST",credentials:"omit",redirect:"error",referrerPolicy:"no-referrer",body:'{"code":"once"}' });
  fetchMock.mockResolvedValue(Response.json({accessToken:3}));
  await expect(oauth.exchangeCode("once")).rejects.toThrow();
});
