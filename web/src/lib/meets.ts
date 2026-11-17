/**
 * 경마장(venue) 목록 — /races·홈·SEO 공용 단일 진실원 (DB 의존 없음).
 *
 * `races.meet` / `race_results.meet` 에 저장되는 한글 라벨 그대로, 화면 노출 순서.
 * 영천은 2026-09 개장 (시즌 중 매주 일요일). race_plans 는 부경을 "부산경남"으로
 * 저장하므로 그 테이블만 별도 정규화 (race_plans.ts).
 *
 * /form(경마지)은 별도 목록(FORM_MEETS) — 영천 미지원.
 */
export const RACE_VENUES = ["서울", "제주", "부경", "영천"] as const;

export type RaceVenue = (typeof RACE_VENUES)[number];

export function isRaceVenue(v: string): v is RaceVenue {
  return (RACE_VENUES as readonly string[]).includes(v);
}
