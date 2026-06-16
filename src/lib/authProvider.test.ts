import { describe, it, expect } from "vitest";
import { shouldWipeForUser, shouldAutoConnectProvider } from "./authProvider";

describe("shouldWipeForUser", () => {
  it("wipes only on a confirmed different user id", () => {
    expect(shouldWipeForUser(1, 2)).toBe(true);
  });
  it("keeps data for the same user", () => {
    expect(shouldWipeForUser(1, 1)).toBe(false);
  });
  it("never wipes when either id is unknown", () => {
    // null = couldn't determine — wiping here would lose data, and
    // returning true on the cached-null side would wipe on first login.
    expect(shouldWipeForUser(null, 2)).toBe(false);
    expect(shouldWipeForUser(1, null)).toBe(false);
    expect(shouldWipeForUser(null, null)).toBe(false);
  });
});

describe("shouldAutoConnectProvider", () => {
  it("auto-connects when provider is wired, no manual token, not opted out", () => {
    expect(shouldAutoConnectProvider(true, false, false)).toBe(true);
  });
  it("never auto-connects after an explicit disconnect", () => {
    // The bug: a live SSO cookie re-adopted the session on every reload
    // even after the user cleared local state. The opt-out must win — this
    // is the only thing that breaks that loop from the frontend.
    expect(shouldAutoConnectProvider(true, false, true)).toBe(false);
  });
  it("manual token takes priority over the provider", () => {
    expect(shouldAutoConnectProvider(true, true, false)).toBe(false);
  });
  it("inert when the build didn't wire a provider", () => {
    expect(shouldAutoConnectProvider(false, false, false)).toBe(false);
  });
});
