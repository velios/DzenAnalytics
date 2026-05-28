import { describe, it, expect } from "vitest";
import { parseAndValidateBackup } from "./backup";

describe("parseAndValidateBackup", () => {
  it("accepts a well-formed backup", () => {
    const out = parseAndValidateBackup(
      JSON.stringify({ version: 1, transactions: [{ id: "a" }], rates: { base: "RUB", rates: {} } })
    );
    expect(out.version).toBe(1);
    expect(Array.isArray(out.transactions)).toBe(true);
  });

  it("rejects non-JSON", () => {
    expect(() => parseAndValidateBackup("{not json")).toThrow();
  });

  it("rejects a non-object top level (array / primitive)", () => {
    expect(() => parseAndValidateBackup("[1,2,3]")).toThrow();
    expect(() => parseAndValidateBackup("42")).toThrow();
  });

  it("rejects a file without a version field", () => {
    expect(() => parseAndValidateBackup(JSON.stringify({ transactions: [] }))).toThrow();
  });

  it("rejects transactions that aren't an array", () => {
    expect(() =>
      parseAndValidateBackup(JSON.stringify({ version: 1, transactions: "oops" }))
    ).toThrow();
  });

  it("strips prototype-pollution keys from nested objects", () => {
    const out = parseAndValidateBackup(
      '{"version":1,"rates":{"base":"RUB","__proto__":{"polluted":true}}}'
    );
    // The dangerous key must not survive into the sanitized output...
    expect(Object.prototype.hasOwnProperty.call(out.rates, "__proto__")).toBe(false);
    // ...and global Object.prototype must remain unpolluted.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
