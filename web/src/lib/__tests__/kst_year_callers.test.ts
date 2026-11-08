import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// searchHorses 의 SQL 파라미터만 보면 되므로 DB 는 mock.
const queryMock = vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(
  async () => [],
);
vi.mock("../db", () => ({
  query: (sql: string, params?: unknown[]) => queryMock(sql, params),
}));

import { searchHorses } from "../horses";
import { resolvePlanYear } from "../race_plans";

// UTC 2026-12-31 15:30 = KST 2027-01-01 00:30 — UTC 프로세스의 getFullYear() 는 2026.
const KST_NEW_YEAR = new Date("2026-12-31T15:30:00Z");
const KST_OLD_YEAR = new Date("2026-12-31T14:30:00Z");

describe("resolvePlanYear (/races/schedule)", () => {
  it("검증 통과한 ?year= 가 최우선", () => {
    expect(resolvePlanYear("2025", [2027, 2026], KST_NEW_YEAR)).toBe(2025);
    expect(resolvePlanYear(["2024", "2023"], [2027], KST_NEW_YEAR)).toBe(2024);
  });

  it("불량 year 는 DB 최신 연도로", () => {
    expect(resolvePlanYear("abc", [2026, 2025], KST_NEW_YEAR)).toBe(2026);
    expect(resolvePlanYear("99999", [2026], KST_NEW_YEAR)).toBe(2026);
    expect(resolvePlanYear(undefined, [2026], KST_NEW_YEAR)).toBe(2026);
  });

  it("DB 도 비면 KST 올해 — UTC 12/31 15:30 은 이미 2027", () => {
    expect(resolvePlanYear(undefined, [], KST_NEW_YEAR)).toBe(2027);
    expect(resolvePlanYear("abc", [], KST_OLD_YEAR)).toBe(2026);
  });
});

describe("searchHorses 나이 검색 — KST 연도 기준 출생년도", () => {
  beforeEach(() => {
    queryMock.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("KST 1/1 00:30 (UTC 12/31) 에 '5세' → 2027-5 = 2022", async () => {
    vi.setSystemTime(KST_NEW_YEAR);
    const hit = await searchHorses("5세");
    expect(hit.mode).toBe("age");
    expect(hit.birthYear).toBe(2022);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual([2022, 60, 0]);
  });

  it("KST 12/31 23:30 에 '5' → 2026-5 = 2021", async () => {
    vi.setSystemTime(KST_OLD_YEAR);
    const hit = await searchHorses("5");
    expect(hit.birthYear).toBe(2021);
    expect(queryMock.mock.calls[0][1]).toEqual([2021, 60, 0]);
  });

  it("4자리 연도 입력은 시계와 무관", async () => {
    vi.setSystemTime(KST_NEW_YEAR);
    const hit = await searchHorses("2020");
    expect(hit).toMatchObject({ mode: "year", birthYear: 2020 });
  });
});
