import { describe, expect, it } from "vitest";
import {
  buildRaceCanonical,
  buildRaceDescription,
  buildRaceTitle,
  normalizeRaceDate,
  normalizeRaceParams,
  raceDetailPath,
} from "../race-seo";

const SEOUL = encodeURIComponent("서울");

describe("normalizeRaceDate", () => {
  it("유효한 YYYY-MM-DD 통과", () => {
    expect(normalizeRaceDate("2026-11-01")).toBe("2026-11-01");
    expect(normalizeRaceDate("2024-02-29")).toBe("2024-02-29");
  });
  it("형식 불량·달력상 없는 날짜 거부", () => {
    expect(normalizeRaceDate(undefined)).toBeNull();
    expect(normalizeRaceDate("")).toBeNull();
    expect(normalizeRaceDate("20261101")).toBeNull();
    expect(normalizeRaceDate("2026-1-1")).toBeNull();
    expect(normalizeRaceDate("2026-02-30")).toBeNull();
    expect(normalizeRaceDate("2025-02-29")).toBeNull();
    expect(normalizeRaceDate("2026-13-01")).toBeNull();
    expect(normalizeRaceDate("2026-11-01'; drop")).toBeNull();
  });
  it("배열이면 첫 값 사용", () => {
    expect(normalizeRaceDate(["2026-11-01", "2026-11-02"])).toBe("2026-11-01");
  });
});

describe("buildRaceCanonical — 페이지 자기 URL 정규화", () => {
  it("경주 상세: 파라미터 순서 고정 + venue 인코딩", () => {
    const p = normalizeRaceParams({ race: "3", venue: "서울", date: "2026-11-01" });
    expect(buildRaceCanonical(p)).toBe(`/races?date=2026-11-01&venue=${SEOUL}&race=3`);
  });
  it("race 0 패딩·공백 정규화", () => {
    const p = normalizeRaceParams({ date: " 2026-11-01 ", venue: "서울", race: "03" });
    expect(buildRaceCanonical(p)).toBe(`/races?date=2026-11-01&venue=${SEOUL}&race=3`);
  });
  it("앱 내부 링크 형식과 동일", () => {
    expect(raceDetailPath("2026-11-01", "부경", 7)).toBe(
      `/races?date=2026-11-01&venue=${encodeURIComponent("부경")}&race=7`,
    );
  });
  it("날짜만 유효 → /races?date=", () => {
    expect(buildRaceCanonical(normalizeRaceParams({ date: "2026-11-01" }))).toBe(
      "/races?date=2026-11-01",
    );
    // 모르는 경마장·불량 race 번호는 날짜 페이지로 수렴
    expect(
      buildRaceCanonical(normalizeRaceParams({ date: "2026-11-01", venue: "<x>", race: "3" })),
    ).toBe("/races?date=2026-11-01");
    expect(
      buildRaceCanonical(normalizeRaceParams({ date: "2026-11-01", venue: "서울", race: "0" })),
    ).toBe("/races?date=2026-11-01");
    expect(
      buildRaceCanonical(normalizeRaceParams({ date: "2026-11-01", venue: "서울", race: "abc" })),
    ).toBe("/races?date=2026-11-01");
    expect(
      buildRaceCanonical(normalizeRaceParams({ date: "2026-11-01", venue: "서울", race: "100" })),
    ).toBe("/races?date=2026-11-01");
  });
  it("파라미터 없음·날짜 불량 → /races", () => {
    expect(buildRaceCanonical(normalizeRaceParams({}))).toBe("/races");
    expect(
      buildRaceCanonical(normalizeRaceParams({ date: "nope", venue: "서울", race: "3" })),
    ).toBe("/races");
  });
});

describe("buildRaceTitle / buildRaceDescription", () => {
  const base = {
    race_name: null,
    grade: "국6등급",
    distance: 1200,
    track_type: "모래",
    has_results: true,
  };
  it("일반 경주: 경주명 없이 날짜·경마장·R", () => {
    expect(buildRaceTitle("2026-11-01", "서울", 3, base)).toBe("2026-11-01 서울 3R 경주 결과");
  });
  it("대상경주는 경주명 포함", () => {
    expect(
      buildRaceTitle("2026-11-01", "서울", 9, { ...base, race_name: "그랑프리", grade: "G1" }),
    ).toBe("2026-11-01 서울 9R 그랑프리 경주 결과");
  });
  it("결과 미적재면 출전표", () => {
    expect(buildRaceTitle("2026-11-01", "제주", 1, { ...base, has_results: false })).toBe(
      "2026-11-01 제주 1R 출전표",
    );
  });
  it("DB 에 없는 경주도 크래시 없이 기본 제목", () => {
    expect(buildRaceTitle("2026-11-01", "부경", 2, null)).toBe("2026-11-01 부경 2R 경주 결과");
    expect(buildRaceDescription("2026-11-01", "부경", 2, null)).toContain(
      "2026년 11월 1일 부경 제2경주",
    );
  });
  it("설명에 거리·등급·주로", () => {
    expect(buildRaceDescription("2026-11-01", "서울", 3, base)).toBe(
      "2026년 11월 1일 서울 제3경주 (1200m · 국6등급 · 모래) — 착순·출전마·기수·조교사·배당 데이터.",
    );
  });
});
