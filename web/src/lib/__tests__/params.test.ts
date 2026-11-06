import { describe, expect, it } from "vitest";
import { parsePositiveInt } from "../params";

describe("parsePositiveInt", () => {
  it("양의 정수 통과", () => {
    expect(parsePositiveInt("1")).toBe(1);
    expect(parsePositiveInt("42")).toBe(42);
    expect(parsePositiveInt("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("숫자가 아니거나 0 이하·비정규 표기는 거부", () => {
    for (const v of [
      undefined,
      "",
      " ",
      "abc",
      "0",
      "-1",
      "+1",
      "1.5",
      "1e3",
      "0x10",
      "007",
      " 7",
      "7 ",
      "7abc",
      "1; drop table contact_posts",
      "١٢", // 아라비아-인도 숫자
      "Infinity",
      "NaN",
    ]) {
      expect(parsePositiveInt(v), JSON.stringify(v)).toBeNull();
    }
  });

  it("safe integer 초과·자릿수 초과 거부", () => {
    expect(parsePositiveInt("9007199254740992")).toBeNull();
    expect(parsePositiveInt("99999999999999999999")).toBeNull();
  });

  it("max 상한 적용", () => {
    expect(parsePositiveInt("2026", 9999)).toBe(2026);
    expect(parsePositiveInt("10000", 9999)).toBeNull();
    expect(parsePositiveInt("2147483648", 2147483647)).toBeNull();
  });

  it("배열이면 첫 값 사용", () => {
    expect(parsePositiveInt(["3", "x"])).toBe(3);
    expect(parsePositiveInt(["x", "3"])).toBeNull();
    expect(parsePositiveInt([])).toBeNull();
  });
});
