import { describe, expect, it } from "vitest";

import {
  canonicalComboKey,
  comboCount,
  enumerateCombos,
} from "../bet_combinations";

describe("enumerateCombos — STRAIGHT", () => {
  it("WIN: 1두 1조합", () => {
    expect(enumerateCombos("WIN", { kind: "STRAIGHT", horses: [3] })).toEqual([
      [3],
    ]);
  });

  it("EXA: 순서 보존", () => {
    expect(
      enumerateCombos("EXA", { kind: "STRAIGHT", horses: [3, 7] }),
    ).toEqual([[3, 7]]);
  });

  it("TLA: 3두 1조합", () => {
    expect(
      enumerateCombos("TLA", { kind: "STRAIGHT", horses: [1, 2, 3] }),
    ).toEqual([[1, 2, 3]]);
  });

  it("STRAIGHT 두수 부족 시 throw", () => {
    expect(() =>
      enumerateCombos("EXA", { kind: "STRAIGHT", horses: [1] }),
    ).toThrow();
  });
});

describe("enumerateCombos — BOX", () => {
  it("BOX QNL N=4 → C(4,2)=6", () => {
    const c = enumerateCombos("QNL", { kind: "BOX", horses: [1, 2, 3, 4] });
    expect(c.length).toBe(6);
    expect(c).toContainEqual([1, 2]);
    expect(c).toContainEqual([3, 4]);
  });

  it("BOX EXA N=4 → P(4,2)=12", () => {
    const c = enumerateCombos("EXA", { kind: "BOX", horses: [1, 2, 3, 4] });
    expect(c.length).toBe(12);
    expect(c).toContainEqual([1, 2]);
    expect(c).toContainEqual([2, 1]); // ordered → 양쪽 포함
  });

  it("BOX TRI N=5 → C(5,3)=10", () => {
    const c = enumerateCombos("TRI", {
      kind: "BOX",
      horses: [1, 2, 3, 4, 5],
    });
    expect(c.length).toBe(10);
  });

  it("BOX TLA N=4 → P(4,3)=24", () => {
    const c = enumerateCombos("TLA", { kind: "BOX", horses: [1, 2, 3, 4] });
    expect(c.length).toBe(24);
  });

  it("BOX QNL N=10 → C(10,2)=45", () => {
    expect(
      comboCount("QNL", {
        kind: "BOX",
        horses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      }),
    ).toBe(45);
  });

  it("BOX 두수 부족 시 throw", () => {
    expect(() =>
      enumerateCombos("TRI", { kind: "BOX", horses: [1, 2] }),
    ).toThrow();
  });

  it("중복 chul_no 면 throw", () => {
    expect(() =>
      enumerateCombos("QNL", { kind: "BOX", horses: [1, 1, 2] }),
    ).toThrow();
  });
});

describe("enumerateCombos — FORMATION", () => {
  it("FORMATION TLA 축[1] 상대[3,5,7] → 3조합 (1·*·*)", () => {
    const c = enumerateCombos("TLA", {
      kind: "FORMATION",
      slots: [[1], [3, 5, 7], [3, 5, 7]],
    });
    // 1·3·5, 1·3·7, 1·5·3, 1·5·7, 1·7·3, 1·7·5 = 6조합
    expect(c.length).toBe(6);
  });

  it("FORMATION TLA 1·2·3착 축 [1,2]·[3]·[4,5,6] → 6조합", () => {
    const c = enumerateCombos("TLA", {
      kind: "FORMATION",
      slots: [[1, 2], [3], [4, 5, 6]],
    });
    expect(c.length).toBe(6);
    expect(c).toContainEqual([1, 3, 4]);
    expect(c).toContainEqual([2, 3, 6]);
  });

  it("FORMATION QNL unordered: 슬롯 [1]·[3,5,7] → 3조합 (중복 제거)", () => {
    const c = enumerateCombos("QNL", {
      kind: "FORMATION",
      slots: [[1], [3, 5, 7]],
    });
    expect(c.length).toBe(3);
  });

  it("FORMATION 같은 말 두 슬롯 → 자동 제거", () => {
    const c = enumerateCombos("EXA", {
      kind: "FORMATION",
      slots: [[1, 2], [1, 2]],
    });
    // (1,2), (2,1) — 같은 말 양쪽 슬롯 불가
    expect(c.length).toBe(2);
  });
});

describe("canonicalComboKey", () => {
  it("QNL [3,1] → '1-3' (정렬)", () => {
    expect(canonicalComboKey("QNL", [3, 1])).toBe("1-3");
  });

  it("EXA [3,1] → '3-1' (원순서)", () => {
    expect(canonicalComboKey("EXA", [3, 1])).toBe("3-1");
  });

  it("TRI [5,2,8] → '2-5-8'", () => {
    expect(canonicalComboKey("TRI", [5, 2, 8])).toBe("2-5-8");
  });

  it("TLA [5,2,8] → '5-2-8'", () => {
    expect(canonicalComboKey("TLA", [5, 2, 8])).toBe("5-2-8");
  });

  it("WIN 단일 [3] → '3'", () => {
    expect(canonicalComboKey("WIN", [3])).toBe("3");
  });
});
