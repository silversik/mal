import { beforeEach, describe, expect, it, vi } from "vitest";

// getHorseCompareSummaries 의 SQL·파라미터만 보면 되므로 DB 는 mock.
const queryMock = vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(
  async () => [],
);
vi.mock("../db", () => ({
  query: (sql: string, params?: unknown[]) => queryMock(sql, params),
}));

import { getHorseCompareSummaries } from "../horses";

const ASOF_FILTER = "(rr.race_date, rr.race_no) < ($3::date, $4::int)";

describe("getHorseCompareSummaries — as-of (look-ahead 방지)", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockImplementation(async () => []);
  });

  it("asOf 지정 시 두 쿼리 모두 경주 이전 결과로 제한", async () => {
    await getHorseCompareSummaries(["A", "B"], { raceDate: "2026-03-01", raceNo: 5 });
    expect(queryMock).toHaveBeenCalledTimes(2);
    for (const [sql, params] of queryMock.mock.calls) {
      expect(params).toEqual(["A", "B", "2026-03-01", 5]);
      expect(sql).toContain(ASOF_FILTER);
    }
    // 통산·1착은 현재 누계인 horses 마스터가 아니라 필터된 race_results 에서.
    const statsSql = queryMock.mock.calls[0][0];
    expect(statsSql).not.toContain("h.total_race_count");
    expect(statsSql).not.toContain("h.first_place_count");
  });

  it("asOf 생략 시 기존 동작 (현재 시점 통산)", async () => {
    await getHorseCompareSummaries(["A", "B"]);
    expect(queryMock).toHaveBeenCalledTimes(2);
    for (const [sql, params] of queryMock.mock.calls) {
      expect(params).toEqual(["A", "B"]);
      expect(sql).not.toContain("race_date, rr.race_no) <");
    }
    expect(queryMock.mock.calls[0][0]).toContain("h.total_race_count");
  });

  it("결과 매핑 — 숫자 변환 + recent_finishes oldest-first", async () => {
    queryMock
      .mockResolvedValueOnce([
        {
          horse_no: "A",
          horse_name: "말A",
          total_race_count: "7",
          first_place_count: "2",
          second_place_count: "1",
          third_place_count: "0",
        },
      ])
      .mockResolvedValueOnce([
        { horse_no: "A", rank: 1, rn: 1 },
        { horse_no: "A", rank: 4, rn: 2 },
        { horse_no: "A", rank: null, rn: 3 },
      ]);
    const out = await getHorseCompareSummaries(["A"], { raceDate: "2026-03-01", raceNo: 5 });
    expect(out).toEqual([
      {
        horse_no: "A",
        horse_name: "말A",
        total_race_count: 7,
        first_place_count: 2,
        second_place_count: 1,
        third_place_count: 0,
        recent_finishes: [null, 4, 1],
      },
    ]);
  });

  it("빈 입력은 DB 호출 없이 []", async () => {
    expect(await getHorseCompareSummaries([], { raceDate: "2026-03-01", raceNo: 5 })).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
