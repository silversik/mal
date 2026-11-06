import { describe, expect, it, vi } from "vitest";

import { kstToday, kstYear } from "../kst";
import {
  buildRankingsHref,
  shouldFallbackToPrevYear,
  withPrevYearFallback,
} from "../rankings-shared";

describe("kstToday / kstYear", () => {
  it("UTC 12/31 15:00 = KST 1/1 00:00 → 새해", () => {
    const d = new Date("2026-12-31T15:00:00Z");
    expect(kstToday(d)).toBe("2027-01-01");
    expect(kstYear(d)).toBe(2027);
  });

  it("UTC 12/31 14:59 = KST 12/31 23:59 → 아직 작년", () => {
    const d = new Date("2026-12-31T14:59:59Z");
    expect(kstToday(d)).toBe("2026-12-31");
    expect(kstYear(d)).toBe(2026);
  });

  it("UTC 자정~09시 구간도 KST 날짜", () => {
    expect(kstToday(new Date("2026-11-06T00:30:00Z"))).toBe("2026-11-06");
    expect(kstToday(new Date("2026-11-05T23:30:00Z"))).toBe("2026-11-06");
  });

  it("인자 없으면 현재 시각 기준 4자리 연도", () => {
    expect(kstYear()).toBeGreaterThanOrEqual(2026);
    expect(kstToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("shouldFallbackToPrevYear", () => {
  it("자동 조회 + 연도/올해 scope + 0건 → 폴백", () => {
    expect(shouldFallbackToPrevYear({ scope: "year", rowCount: 0, explicit: false })).toBe(true);
    expect(shouldFallbackToPrevYear({ scope: "ytd", rowCount: 0, explicit: false })).toBe(true);
  });

  it("사용자가 명시한 연도는 비어도 존중", () => {
    expect(shouldFallbackToPrevYear({ scope: "year", rowCount: 0, explicit: true })).toBe(false);
  });

  it("결과가 있거나 통산이면 폴백 없음", () => {
    expect(shouldFallbackToPrevYear({ scope: "year", rowCount: 3, explicit: false })).toBe(false);
    expect(shouldFallbackToPrevYear({ scope: "all", rowCount: 0, explicit: false })).toBe(false);
  });
});

describe("withPrevYearFallback", () => {
  const byYear: Record<number, string[]> = { 2026: ["a", "b"], 2027: [] };
  const fetchYear = (y: number) => Promise.resolve(byYear[y] ?? []);

  it("올해 0건 → 직전 연도로 폴백", async () => {
    const fn = vi.fn(fetchYear);
    const r = await withPrevYearFallback(fn, { scope: "ytd", year: 2027, explicit: false });
    expect(r).toEqual({ rows: ["a", "b"], year: 2026, requestedYear: 2027, fellBack: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("명시 연도는 재조회하지 않는다", async () => {
    const fn = vi.fn(fetchYear);
    const r = await withPrevYearFallback(fn, { scope: "year", year: 2027, explicit: true });
    expect(r.fellBack).toBe(false);
    expect(r.year).toBe(2027);
    expect(r.rows).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("결과 있으면 그대로", async () => {
    const fn = vi.fn(fetchYear);
    const r = await withPrevYearFallback(fn, { scope: "year", year: 2026, explicit: false });
    expect(r).toEqual({ rows: ["a", "b"], year: 2026, requestedYear: 2026, fellBack: false });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("직전 연도도 비면 원래 연도(빈 결과) 유지", async () => {
    const r = await withPrevYearFallback(() => Promise.resolve([] as string[]), {
      scope: "year",
      year: 2027,
      explicit: false,
    });
    expect(r).toEqual({ rows: [], year: 2027, requestedYear: 2027, fellBack: false });
  });
});

describe("minRows (/analysis TOP 카드 = 3)", () => {
  const byYear: Record<number, string[]> = {
    2026: ["a", "b", "c", "d", "e"],
    2027: ["x", "y"],
  };
  const fetchYear = (y: number) => Promise.resolve(byYear[y] ?? []);

  it("shouldFallbackToPrevYear: rowCount < minRows 이면 폴백", () => {
    expect(shouldFallbackToPrevYear({ scope: "ytd", rowCount: 2, explicit: false, minRows: 3 })).toBe(true);
    expect(shouldFallbackToPrevYear({ scope: "ytd", rowCount: 3, explicit: false, minRows: 3 })).toBe(false);
    expect(shouldFallbackToPrevYear({ scope: "ytd", rowCount: 2, explicit: true, minRows: 3 })).toBe(false);
    expect(shouldFallbackToPrevYear({ scope: "all", rowCount: 0, explicit: false, minRows: 3 })).toBe(false);
  });

  it("기본(minRows 1, /rankings)은 1~2행이어도 올해 유지", async () => {
    const fn = vi.fn(fetchYear);
    const r = await withPrevYearFallback(fn, { scope: "ytd", year: 2027 });
    expect(r).toEqual({ rows: ["x", "y"], year: 2027, requestedYear: 2027, fellBack: false });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("minRows 3: 올해 2행 → 직전 연도 5행으로 폴백", async () => {
    const r = await withPrevYearFallback(fetchYear, { scope: "ytd", year: 2027, minRows: 3 });
    expect(r).toEqual({ rows: ["a", "b", "c", "d", "e"], year: 2026, requestedYear: 2027, fellBack: true });
  });

  it("minRows 3: 직전 연도가 올해보다 많지 않으면 올해 유지", async () => {
    const thin = (y: number) => Promise.resolve(y === 2027 ? ["x", "y"] : ["p"]);
    const r = await withPrevYearFallback(thin, { scope: "ytd", year: 2027, minRows: 3 });
    expect(r).toEqual({ rows: ["x", "y"], year: 2027, requestedYear: 2027, fellBack: false });
  });
});

describe("buildRankingsHref", () => {
  it("기본: entity + scope (+ year 는 연도별일 때만)", () => {
    expect(buildRankingsHref({ entity: "jockey", scope: "year", year: 2026 })).toBe(
      "/rankings?entity=jockey&scope=year&year=2026",
    );
    expect(buildRankingsHref({ entity: "horse", scope: "ytd", year: 2027 })).toBe(
      "/rankings?entity=horse&scope=ytd",
    );
  });

  it("폴백 화면의 대상 탭(omitPeriod)은 scope/year 를 빼 새 대상도 폴백 판단을 다시 하게", () => {
    expect(
      buildRankingsHref({ entity: "trainer", scope: "year", year: 2026 }, { omitPeriod: true }),
    ).toBe("/rankings?entity=trainer");
  });
});
