import { describe, it, expect } from "vitest";
import { isSafeRegexSource, safeCompileRegex, safeTest } from "./safeRegex";

describe("isSafeRegexSource", () => {
  it("accepts simple real-world patterns", () => {
    expect(isSafeRegexSource("^яндекс")).toBe(true);
    expect(isSafeRegexSource("магнит|пятёроч")).toBe(true);
    expect(isSafeRegexSource("\\d{4}")).toBe(true);
  });

  it("rejects empty and over-long patterns", () => {
    expect(isSafeRegexSource("")).toBe(false);
    expect(isSafeRegexSource("a".repeat(201))).toBe(false);
  });

  it("rejects catastrophic nested-quantifier patterns (ReDoS)", () => {
    expect(isSafeRegexSource("(a+)+")).toBe(false);
    expect(isSafeRegexSource("(a*)*")).toBe(false);
    expect(isSafeRegexSource("(.*)+")).toBe(false);
    expect(isSafeRegexSource("([a-z]+)*")).toBe(false);
  });
});

describe("safeCompileRegex", () => {
  it("compiles a safe pattern", () => {
    const re = safeCompileRegex("^abc", "u");
    expect(re).toBeInstanceOf(RegExp);
    expect(re!.test("abcdef")).toBe(true);
  });

  it("returns null for an unsafe pattern instead of compiling it", () => {
    expect(safeCompileRegex("(a+)+$", "u")).toBeNull();
  });

  it("returns null (never throws) for invalid regex syntax", () => {
    expect(safeCompileRegex("(", "u")).toBeNull();
  });
});

describe("safeTest", () => {
  it("matches within the haystack cap", () => {
    expect(safeTest(/abc/, "xxabcxx")).toBe(true);
  });

  it("only inspects the capped prefix of a huge haystack", () => {
    // Pattern matches only at the very end of a >2000-char string —
    // beyond the cap, so it should NOT match (proves the slice runs).
    const huge = "a".repeat(5000) + "NEEDLE";
    expect(safeTest(/NEEDLE/, huge)).toBe(false);
  });
});
