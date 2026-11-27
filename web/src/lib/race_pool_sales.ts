import { query } from "./db";
import { normMeetSql, storedMeetLabels } from "./meets";

/**
 * 경주별·풀별 매출액 — race_pool_sales 테이블 (KRA API179_1).
 *
 * pool: 단식, 연식, 쌍식, 복식, 복연, 삼복, 삼쌍 — 총 7종.
 * amount: 원 단위 (BIGINT). UI 에서는 만원/억원 단위로 축약.
 * odds_summary: "②-1.1  ⑧-1.1  ⑪-3" 형태 텍스트 — 인기 1~3 위 요약.
 */
export type RacePoolSales = {
  pool: string;
  amount: string;          // BIGINT → string (precision 보존)
  odds_summary: string | null;
};

// 표시 순서 — KRA 풀 개시 순서. 공시 순서와 사용자 친숙도 모두 만족.
export const POOL_DISPLAY_ORDER = [
  "단식",
  "연식",
  "쌍식",
  "복식",
  "복연",
  "삼복",
  "삼쌍",
] as const;

// 한 경주의 풀별 행 — 저장 라벨 후보 전부로 찾고($2 = text[]), 같은 풀이 두 라벨로
// 겹쳐 있으면 한 번만 센다 (정규 라벨 행 우선). 겹친 채로 합치면 매출이 두 배가 된다.
const POOL_ROWS_SQL = `
  SELECT DISTINCT ON (pool) pool, amount, odds_summary
    FROM race_pool_sales
   WHERE race_date = $1::date AND meet = ANY($2::text[]) AND race_no = $3
   ORDER BY pool, (meet <> ${normMeetSql("meet")}), meet`;

export async function getRacePoolSales(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<RacePoolSales[]> {
  return query<RacePoolSales>(
    `SELECT pool, amount::text AS amount, odds_summary
       FROM (${POOL_ROWS_SQL}) s
      ORDER BY array_position(
        ARRAY['단식','연식','쌍식','복식','복연','삼복','삼쌍']::text[],
        pool
      ) NULLS LAST`,
    [raceDate, storedMeetLabels(meet), raceNo],
  );
}

/** 한 경주의 모든 풀 매출 합계 (원). UI 에서 "총 매출 X억" 표시용. */
export async function getRaceTotalSales(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<number> {
  const rows = await query<{ total: string | null }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM (${POOL_ROWS_SQL}) s`,
    [raceDate, storedMeetLabels(meet), raceNo],
  );
  return Number(rows[0]?.total ?? 0);
}
