import { describe, it, expect } from "vitest";
import { shouldWipeForUser } from "./authProvider";

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
