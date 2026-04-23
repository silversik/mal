import { query } from "./db";

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

export async function getRacePoolSales(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<RacePoolSales[]> {
  return query<RacePoolSales>(
    `SELECT pool, amount::text AS amount, odds_summary
       FROM race_pool_sales
      WHERE race_date = $1::date AND meet = $2 AND race_no = $3
      ORDER BY array_position(
        ARRAY['단식','연식','쌍식','복식','복연','삼복','삼쌍']::text[],
        pool
      ) NULLS LAST`,
    [raceDate, meet, raceNo],
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
       FROM race_pool_sales
      WHERE race_date = $1::date AND meet = $2 AND race_no = $3`,
    [raceDate, meet, raceNo],
  );
  return Number(rows[0]?.total ?? 0);
}
