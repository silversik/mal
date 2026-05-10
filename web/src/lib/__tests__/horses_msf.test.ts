import { describe, expect, it } from "vitest";
import { computeMsf } from "../horses";

describe("computeMsf — mal지수 (MSF)", () => {
  it("1착과 동일 기록은 100", () => {
    expect(computeMsf(60, 60)).toBe(100);
  });

  it("1착보다 1% 느리면 99 (소수점 1자리)", () => {
    // 본인 60.6초, 1착 60초 → 60/60.6*100 = 99.0099... → 99.0
    expect(computeMsf(60.6, 60)).toBe(99.0);
  });

  it("1착보다 5% 느리면 95.2 근사", () => {
    // 60 / 63 * 100 = 95.238 → 95.2
    expect(computeMsf(63, 60)).toBe(95.2);
  });

  it("input null/undefined 모두 NULL 처리", () => {
    expect(computeMsf(null, 60)).toBeNull();
    expect(computeMsf(60, null)).toBeNull();
    expect(computeMsf(undefined, 60)).toBeNull();
    expect(computeMsf(60, undefined)).toBeNull();
    expect(computeMsf(null, null)).toBeNull();
  });

  it("0/음수 입력은 NULL 처리 (0 나눗셈 방지)", () => {
    expect(computeMsf(0, 60)).toBeNull();
    expect(computeMsf(60, 0)).toBeNull();
    expect(computeMsf(-1, 60)).toBeNull();
    expect(computeMsf(60, -1)).toBeNull();
  });

  it("1착보다 빠른 케이스 (이론상 불가능하지만 안전 처리)", () => {
    // 실제 데이터 정합성에서 1착 = MIN 이라 발생 안 하지만, 함수 계약 상 100보다 큰 값을 그대로 반환.
    expect(computeMsf(50, 60)).toBe(120);
  });
});
