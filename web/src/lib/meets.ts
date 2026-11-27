/**
 * 경마장(venue) 목록 — /races·홈·SEO 공용 단일 진실원 (DB 의존 없음).
 *
 * 화면에 쓰는 정규 라벨, 화면 노출 순서. 영천은 2026-09 개장 (시즌 중 매주 일요일).
 *
 * DB 저장 라벨은 정규 라벨과 다를 수 있다 — 부경은 테이블·시기에 따라 "부경" 또는
 * "부산경남" 으로 저장돼 있다 (race_results·race_dividends·race_entries 는 2026-08 부터
 * "부산경남", race_pool_sales 는 "부경", races 는 같은 경주가 두 라벨 행으로 따로 있다).
 * 그래서 경주를 찾는 쿼리는 라벨 그대로 비교하지 않고 아래 헬퍼를 쓴다:
 *   - 파라미터로 찾을 때  `meet = ANY($n::text[])`  ← storedMeetLabels(meet)
 *   - 테이블끼리 맞출 때  normMeetSql("a.meet") = normMeetSql("b.meet")
 *   - 화면으로 내보낼 때  normMeetSql("x.meet") AS meet
 *
 * /form(경마지)은 별도 목록(FORM_MEETS) — 영천 미지원.
 */
export const RACE_VENUES = ["서울", "제주", "부경", "영천"] as const;

export type RaceVenue = (typeof RACE_VENUES)[number];

export function isRaceVenue(v: string): v is RaceVenue {
  return (RACE_VENUES as readonly string[]).includes(v);
}

/** 정규 라벨 → DB 저장 라벨 후보 (정규 라벨이 맨 앞). 여기 없는 경마장은 라벨이 하나뿐. */
export const MEET_STORED_LABELS: Readonly<Record<string, readonly string[]>> = {
  부경: ["부경", "부산경남"],
};

/** 저장 라벨·정규 라벨 → 정규 라벨 ("부산경남" → "부경"). 모르는 값은 그대로. */
export function canonicalMeet(meet: string): string {
  for (const [canon, labels] of Object.entries(MEET_STORED_LABELS)) {
    if (labels.includes(meet)) return canon;
  }
  return meet;
}

/** 이 경마장이 DB 에 저장돼 있을 수 있는 라벨 전부 — `meet = ANY($n::text[])` 파라미터용. */
export function storedMeetLabels(meet: string): string[] {
  const canon = canonicalMeet(meet);
  return [...(MEET_STORED_LABELS[canon] ?? [canon])];
}

/**
 * 저장 라벨 컬럼 → 정규 라벨 SQL 식. col 은 코드에 적은 고정 컬럼명만 넘긴다(사용자 입력 금지).
 * 별칭이 없는 값(서울·제주·영천·NULL)은 그대로 둔다.
 */
export function normMeetSql(col: string): string {
  const whens = Object.entries(MEET_STORED_LABELS)
    .flatMap(([canon, labels]) =>
      labels.filter((l) => l !== canon).map((l) => `WHEN '${l}' THEN '${canon}'`),
    )
    .join(" ");
  return whens ? `(CASE ${col} ${whens} ELSE ${col} END)` : col;
}
