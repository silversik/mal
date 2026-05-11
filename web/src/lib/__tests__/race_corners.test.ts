import { describe, expect, it } from "vitest";
import { parsePassrank, passrankSeriesByHorse } from "../race_corners";

describe("parsePassrank — KRA 통과순위 텍스트 파서", () => {
  it("기본 케이스 — 모든 마필이 단독 등수", () => {
    expect(parsePassrank("1-2-3-4")).toEqual([
      { rank: 1, chul_nos: [1] },
      { rank: 2, chul_nos: [2] },
      { rank: 3, chul_nos: [3] },
      { rank: 4, chul_nos: [4] },
    ]);
  });

  it("동률 그룹 — 다음 등수는 그룹 크기만큼 skip", () => {
    expect(parsePassrank("(1,3,9)-7-2")).toEqual([
      { rank: 1, chul_nos: [1, 3, 9] },
      { rank: 4, chul_nos: [7] },
      { rank: 5, chul_nos: [2] },
    ]);
  });

  it("`^` 선두 마크 무시", () => {
    expect(parsePassrank("(^1,3,9)-7,2,6,(5,8),4")).toEqual([
      { rank: 1, chul_nos: [1, 3, 9] },
      { rank: 4, chul_nos: [7] },
      { rank: 5, chul_nos: [2] },
      { rank: 6, chul_nos: [6] },
      { rank: 7, chul_nos: [5, 8] },
      { rank: 9, chul_nos: [4] },
    ]);
  });

  it("`=` 큰 간격 — `-` 와 동일 분리", () => {
    expect(parsePassrank("1=2-3")).toEqual([
      { rank: 1, chul_nos: [1] },
      { rank: 2, chul_nos: [2] },
      { rank: 3, chul_nos: [3] },
    ]);
  });

  it("`·` (가운데 점) 큰 간격 처리 — 등수 sep", () => {
    // ... =11 ·6: 11 단독 9등, 6 단독 10등
    expect(parsePassrank("1-3-7-(8,4),10-(9,5),2=11 ·6")).toEqual([
      { rank: 1, chul_nos: [1] },
      { rank: 2, chul_nos: [3] },
      { rank: 3, chul_nos: [7] },
      { rank: 4, chul_nos: [8, 4] },
      { rank: 6, chul_nos: [10] },
      { rank: 7, chul_nos: [9, 5] },
      { rank: 9, chul_nos: [2] },
      { rank: 10, chul_nos: [11] },
      { rank: 11, chul_nos: [6] },
    ]);
  });

  it("null / 빈 입력은 빈 배열", () => {
    expect(parsePassrank(null)).toEqual([]);
    expect(parsePassrank("")).toEqual([]);
  });
});

describe("passrankSeriesByHorse — 마필별 시계열 빌더", () => {
  it("두 stage 의 그룹을 chul_no 별 라인으로 변환", () => {
    const stages = [
      { key: "passrank_s1f", text: "(1,2)-3" }, // 1=1등, 2=1등, 3=3등
      { key: "passrank_g1f", text: "3-1-2" },   // 3=1등, 1=2등, 2=3등
    ];
    const { stageKeys, rankByHorse } = passrankSeriesByHorse(stages);
    expect(stageKeys).toEqual(["passrank_s1f", "passrank_g1f"]);
    expect(rankByHorse.get(1)).toEqual([1, 2]);
    expect(rankByHorse.get(2)).toEqual([1, 3]);
    expect(rankByHorse.get(3)).toEqual([3, 1]);
  });

  it("stage 에 누락된 마필은 null", () => {
    const stages = [
      { key: "s1", text: "1-2" },
      { key: "g1", text: "1-2-3" },
    ];
    const { rankByHorse } = passrankSeriesByHorse(stages);
    expect(rankByHorse.get(3)).toEqual([null, 3]);
  });
});
