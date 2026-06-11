import { describe, it, expect } from "vitest";
import { pluralRu, pluralOps } from "./plural";

const F: [string, string, string] = ["правка", "правки", "правок"];

describe("pluralRu", () => {
  it("picks the one-form for n%10===1 (except 11)", () => {
    expect(pluralRu(1, F)).toBe("правка");
    expect(pluralRu(21, F)).toBe("правка");
    expect(pluralRu(101, F)).toBe("правка");
  });
  it("picks the few-form for n%10 in 2–4 (except 12–14)", () => {
    expect(pluralRu(2, F)).toBe("правки");
    expect(pluralRu(3, F)).toBe("правки");
    expect(pluralRu(4, F)).toBe("правки");
    expect(pluralRu(22, F)).toBe("правки");
  });
  it("picks the many-form for 0, 5–20, and the 11–14 exception", () => {
    expect(pluralRu(0, F)).toBe("правок");
    expect(pluralRu(5, F)).toBe("правок");
    expect(pluralRu(11, F)).toBe("правок");
    expect(pluralRu(12, F)).toBe("правок");
    expect(pluralRu(14, F)).toBe("правок");
    expect(pluralRu(25, F)).toBe("правок");
  });
});

describe("pluralOps (unchanged)", () => {
  it("declines операция correctly", () => {
    expect(pluralOps(1)).toBe("операция");
    expect(pluralOps(3)).toBe("операции");
    expect(pluralOps(5)).toBe("операций");
    expect(pluralOps(11)).toBe("операций");
  });
});
