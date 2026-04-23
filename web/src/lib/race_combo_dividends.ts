import { query } from "./db";

/**
 * 복식 (조합) 배당 — race_combo_dividends 테이블.
 *
 * pool 종류와 의미:
 *   QNL (복승)   — 2 마 unordered (1·2 위, 순서 무관)
 *   QPL (쌍승식) — 2 마 unordered
 *   EXA (쌍승)   — 2 마 ordered  (1 → 2 위 순서 일치)
 *   TRI (삼복승) — 3 마 unordered
 *   TLA (삼쌍승) — 3 마 ordered
 *
 * horse_no_1/2/3 은 KRA 응답 원순서. UI 에서 ordered pool 은 화살표(→) 로,
 * unordered pool 은 콤마(,) 로 구분해 표시.
 */
export type ComboPool = "QNL" | "QPL" | "EXA" | "TRI" | "TLA";

export type RaceComboDividend = {
  pool: ComboPool;
  horse_no_1: string;
  horse_no_2: string;
  horse_no_3: string | null;
  horse_name_1: string | null;
  horse_name_2: string | null;
  horse_name_3: string | null;
  odds: string | null;  // NUMERIC → string (precision 보존)
};

export const POOL_LABEL: Record<ComboPool, string> = {
  QNL: "복승",
  QPL: "쌍승식",
  EXA: "쌍승",
  TRI: "삼복승",
  TLA: "삼쌍승",
};

export const POOL_ORDERED: Record<ComboPool, boolean> = {
  QNL: false,
  QPL: false,
  EXA: true,
  TRI: false,
  TLA: true,
};

/**
 * 한 경주의 모든 복식 배당. pool · odds 오름차순 (우승 가능성 높은 조합부터).
 * horses 테이블 LEFT JOIN 으로 마명 보강 — race_results 에는 horse_name 컬럼이
 * 없으므로 horses (PK=horse_no) 와 직접 조인. 미매칭 시 horse_no 만 표시.
 */
export async function getRaceComboDividends(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<RaceComboDividend[]> {
  return query<RaceComboDividend>(
    `SELECT
        d.pool,
        d.horse_no_1,
        d.horse_no_2,
        d.horse_no_3,
        h1.horse_name AS horse_name_1,
        h2.horse_name AS horse_name_2,
        h3.horse_name AS horse_name_3,
        d.odds::text AS odds
       FROM race_combo_dividends d
       LEFT JOIN horses h1 ON h1.horse_no = d.horse_no_1
       LEFT JOIN horses h2 ON h2.horse_no = d.horse_no_2
       LEFT JOIN horses h3 ON h3.horse_no = d.horse_no_3
      WHERE d.race_date = $1
        AND d.meet      = $2
        AND d.race_no   = $3
      ORDER BY d.pool, d.odds NULLS LAST`,
    [raceDate, meet, raceNo],
  );
}
