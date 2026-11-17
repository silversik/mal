import { describe, expect, it } from "vitest";

import { generateHorseComment, type CommentInput } from "../horse_comment";
import type { FormRow } from "../horses";

function row(bucket: string, starts: number, win: number, place = 0, show = 0): FormRow {
  return {
    bucket,
    sortKey: 0,
    starts,
    win,
    place,
    show,
    win_rate: starts > 0 ? win / starts : 0,
    in_money_rate: starts > 0 ? (win + place + show) / starts : 0,
    best_time: null,
  };
}

function base(over: Partial<CommentInput> = {}): CommentInput {
  return {
    horse_name: "테스트마",
    total_race_count: 0,
    first_place_count: 0,
    recent_finishes: [],
    form: {
      by_distance: [],
      by_track_type: [],
      by_track_condition: [],
      by_meet: [],
      by_weather: [],
    },
    sire_aggregate: null,
    ...over,
  };
}

const withDistance = (rows: FormRow[]) =>
  base({ form: { ...base().form, by_distance: rows } });

const EVALUATIVE = /상승|안정|회복|우세|검증|선호/;

describe("generateHorseComment — 거리", () => {
  it("모든 거리 버킷이 0승이면 거리 문장을 만들지 않는다", () => {
    const out = generateHorseComment(
      withDistance([row("1200m", 4, 0, 1), row("1400m", 3, 0)]),
    );
    expect(out).not.toMatch(/선호|거리별|0승/);
  });

  it("3전 이상 버킷이 하나뿐이면 비교 문장을 만들지 않는다", () => {
    const out = generateHorseComment(
      withDistance([row("1200m", 5, 2, 1), row("1400m", 2, 1)]),
    );
    expect(out).not.toContain("거리별");
  });

  it("정상 — 입상 분수와 % 를 함께 표기", () => {
    const out = generateHorseComment(
      withDistance([row("1200m", 5, 1, 1), row("1400m", 5, 2, 1, 1)]),
    );
    expect(out).toContain("거리별 입상률 최고 1400m — 입상 4/5 (80%), 2승.");
  });

  it("승률보다 입상률로 순위를 매긴다", () => {
    const out = generateHorseComment(
      withDistance([row("1200m", 5, 2), row("1800m", 5, 1, 2, 1)]),
    );
    expect(out).toContain("1800m — 입상 4/5 (80%), 1승");
  });

  it("0승 버킷은 입상률이 높아도 고르지 않는다", () => {
    const out = generateHorseComment(
      withDistance([row("1200m", 5, 0, 3, 2), row("1400m", 5, 1)]),
    );
    expect(out).toContain("1400m — 입상 1/5 (20%), 1승");
    expect(out).not.toContain("1200m");
  });
});

describe("generateHorseComment — 부마", () => {
  const sire = { parent_name: "부마X", total_children: 12, winners: 7, win_rate: 7 / 12 };

  it("자손 중 우승 경험 비율로 표기하고 '우승률'이라 부르지 않는다", () => {
    const out = generateHorseComment(base({ sire_aggregate: sire }));
    expect(out).toContain("부마 부마X 자손 12두 중 우승 경험 7두 (58%).");
    expect(out).not.toMatch(/우승률|검증/);
  });

  it("자손 5두 미만이면 생략", () => {
    const out = generateHorseComment(
      base({ sire_aggregate: { ...sire, total_children: 4, winners: 3, win_rate: 0.75 } }),
    );
    expect(out).not.toContain("부마");
  });

  it("우승 경험 자손이 없으면 생략", () => {
    const out = generateHorseComment(
      base({ sire_aggregate: { ...sire, winners: 0, win_rate: 0 } }),
    );
    expect(out).not.toContain("부마");
  });
});

describe("generateHorseComment — 주로 · 최근 · 통산", () => {
  const withTrack = (rows: FormRow[]) =>
    base({ form: { ...base().form, by_track_type: rows } });

  it("주로 입상률 50% 초과면 분수로 표기", () => {
    const out = generateHorseComment(withTrack([row("잔디", 6, 2, 1, 1), row("모래", 4, 0, 1)]));
    expect(out).toContain("잔디 주로 입상 4/6 (67%).");
  });

  it("주로 입상률 50% 이하면 생략", () => {
    const out = generateHorseComment(withTrack([row("잔디", 6, 1, 1, 1), row("모래", 4, 0, 1)]));
    expect(out).not.toContain("주로");
  });

  it("최근 폼은 사실만", () => {
    expect(generateHorseComment(base({ recent_finishes: [1, 1, 4, 5, 6] }))).toBe(
      "최근 5전 2승.",
    );
    expect(generateHorseComment(base({ recent_finishes: [2, 3, 1, 7, null] }))).toBe(
      "최근 4전 입상 3회.",
    );
    expect(generateHorseComment(base({ recent_finishes: [5, 6, 3, 8, 9] }))).toBe(
      "최근 5전 입상 1회.",
    );
  });

  it("통산 — 0승 / 정상", () => {
    expect(generateHorseComment(base({ total_race_count: 7 }))).toBe("통산 7전 우승 무.");
    expect(
      generateHorseComment(base({ total_race_count: 10, first_place_count: 2 })),
    ).toBe("통산 10전 2승 (승률 20%).");
  });

  it("입력이 비면 fallback", () => {
    expect(generateHorseComment(base())).toBe(
      "통계가 부족해 자동 코멘트를 생성할 수 없습니다.",
    );
  });

  it("전 항목이 채워져도 평가어가 없다", () => {
    const out = generateHorseComment({
      ...base(),
      total_race_count: 12,
      first_place_count: 3,
      recent_finishes: [1, 1, 2, 3, 1],
      form: {
        ...base().form,
        by_distance: [row("1200m", 6, 2, 2), row("1400m", 6, 1, 1)],
        by_track_type: [row("잔디", 8, 3, 2), row("모래", 4, 0, 1)],
      },
      sire_aggregate: { parent_name: "부마X", total_children: 20, winners: 15, win_rate: 0.75 },
    });
    expect(out).not.toMatch(EVALUATIVE);
  });
});
