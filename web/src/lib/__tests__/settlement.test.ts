import { describe, expect, it } from "vitest";

import type { BetPool } from "../bet_combinations";
import {
  calcPayoutP,
  isHit,
  lookupOdds,
  type OddsMap,
  type RaceFinishers,
} from "../settlement";

const F: RaceFinishers = {
  first: 6,
  second: 10,
  third: 7,
  entryCount: 10,
};
const F_SMALL: RaceFinishers = {
  first: 1,
  second: 2,
  third: null,
  entryCount: 6,
};

describe("isHit — WIN", () => {
  it("1착 chul_no 일치", () => {
    expect(isHit("WIN", [6], F)).toBe(true);
  });
  it("1착 아님", () => {
    expect(isHit("WIN", [10], F)).toBe(false);
  });
});

describe("isHit — PLC", () => {
  it("8두 이상: 1·2·3위 모두 적중", () => {
    expect(isHit("PLC", [6], F)).toBe(true);
    expect(isHit("PLC", [10], F)).toBe(true);
    expect(isHit("PLC", [7], F)).toBe(true);
    expect(isHit("PLC", [3], F)).toBe(false);
  });
  it("5~7두: 1·2위만, 3위는 미적중", () => {
    expect(isHit("PLC", [1], F_SMALL)).toBe(true);
    expect(isHit("PLC", [2], F_SMALL)).toBe(true);
    // F_SMALL 에 3위 없음 — 그래도 PLC 는 1·2 위만 인정
    const F7: RaceFinishers = {
      first: 1,
      second: 2,
      third: 3,
      entryCount: 7,
    };
    expect(isHit("PLC", [3], F7)).toBe(false);
  });
});

describe("isHit — QNL/QPL (unordered 1·2위)", () => {
  it("순서 무관 적중", () => {
    expect(isHit("QNL", [6, 10], F)).toBe(true);
    expect(isHit("QNL", [10, 6], F)).toBe(true);
    expect(isHit("QPL", [6, 10], F)).toBe(true);
  });
  it("3위 포함 → 미적중", () => {
    expect(isHit("QNL", [6, 7], F)).toBe(false);
  });
});

describe("isHit — EXA (ordered 1·2위)", () => {
  it("정확한 순서만 적중", () => {
    expect(isHit("EXA", [6, 10], F)).toBe(true);
    expect(isHit("EXA", [10, 6], F)).toBe(false);
  });
});

describe("isHit — TRI (unordered 1·2·3위)", () => {
  it("순서 무관 1·2·3 적중", () => {
    expect(isHit("TRI", [6, 10, 7], F)).toBe(true);
    expect(isHit("TRI", [7, 6, 10], F)).toBe(true);
    expect(isHit("TRI", [10, 7, 6], F)).toBe(true);
  });
  it("4위 포함 미적중", () => {
    expect(isHit("TRI", [6, 10, 5], F)).toBe(false);
  });
});

describe("isHit — TLA (ordered 1·2·3위)", () => {
  it("정확한 순서만", () => {
    expect(isHit("TLA", [6, 10, 7], F)).toBe(true);
    expect(isHit("TLA", [10, 6, 7], F)).toBe(false);
    expect(isHit("TLA", [7, 10, 6], F)).toBe(false);
  });
});

describe("calcPayoutP", () => {
  it("100P × 5.0 = 500P", () => {
    expect(calcPayoutP(BigInt(100), 5.0)).toBe(BigInt(500));
  });
  it("100P × 1.3 = 130P", () => {
    expect(calcPayoutP(BigInt(100), 1.3)).toBe(BigInt(130));
  });
  it("5,000P × 4.8 = 24,000P", () => {
    expect(calcPayoutP(BigInt(5_000), 4.8)).toBe(BigInt(24_000));
  });
  it("100P × 138.8 = 13,880P", () => {
    expect(calcPayoutP(BigInt(100), 138.8)).toBe(BigInt(13_880));
  });
});

describe("lookupOdds", () => {
  const odds: OddsMap = {
    win: new Map<number, number>([
      [6, 5.0],
      [10, 55.3],
    ]),
    plc: new Map<number, number>([
      [6, 1.3],
      [10, 6.1],
      [7, 5.0],
    ]),
    combo: new Map<BetPool, Map<string, number>>([
      ["QNL", new Map([["6-10", 12.4]])],
      ["EXA", new Map([["6-10", 28.5]])],
      ["TRI", new Map([["6-7-10", 18.3]])],
      ["TLA", new Map([["6-10-7", 142.7]])],
    ]),
  };

  it("WIN", () => {
    expect(lookupOdds("WIN", [6], odds)).toBe(5.0);
    expect(lookupOdds("WIN", [3], odds)).toBeNull();
  });
  it("PLC", () => {
    expect(lookupOdds("PLC", [10], odds)).toBe(6.1);
  });
  it("QNL — 정렬 후 lookup", () => {
    // 입력 [10,6] → key '6-10'
    expect(lookupOdds("QNL", [10, 6], odds)).toBe(12.4);
  });
  it("EXA — 원순서 lookup", () => {
    expect(lookupOdds("EXA", [6, 10], odds)).toBe(28.5);
    expect(lookupOdds("EXA", [10, 6], odds)).toBeNull();
  });
  it("TRI — 정렬 후 lookup", () => {
    expect(lookupOdds("TRI", [10, 6, 7], odds)).toBe(18.3);
  });
  it("TLA — 원순서 lookup", () => {
    expect(lookupOdds("TLA", [6, 10, 7], odds)).toBe(142.7);
    expect(lookupOdds("TLA", [10, 6, 7], odds)).toBeNull();
  });
  it("배당 누락 → null (VOID 처리 트리거)", () => {
    expect(lookupOdds("QPL", [6, 10], odds)).toBeNull();
  });
});
