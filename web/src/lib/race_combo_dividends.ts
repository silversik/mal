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
 *
 * 마명 보강: race_combo_dividends.horse_no_N 은 KRA chulNo (= 출주번호 = 게이트
 * 번호 1~12) 이지 마등록번호가 아니다. 같은 (race_date, meet, race_no) 의
 * race_entries.chul_no 와 매칭해 마명을 끌어온다. 미매칭 시 chul_no 숫자만 표시.
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
        e1.horse_name AS horse_name_1,
        e2.horse_name AS horse_name_2,
        e3.horse_name AS horse_name_3,
        d.odds::text AS odds
       FROM race_combo_dividends d
       LEFT JOIN race_entries e1
              ON e1.race_date = d.race_date
             AND e1.meet      = d.meet
             AND e1.race_no   = d.race_no
             AND e1.chul_no::text = d.horse_no_1
       LEFT JOIN race_entries e2
              ON e2.race_date = d.race_date
             AND e2.meet      = d.meet
             AND e2.race_no   = d.race_no
             AND e2.chul_no::text = d.horse_no_2
       LEFT JOIN race_entries e3
              ON e3.race_date = d.race_date
             AND e3.meet      = d.meet
             AND e3.race_no   = d.race_no
             AND e3.chul_no::text = d.horse_no_3
      WHERE d.race_date = $1
        AND d.meet      = $2
        AND d.race_no   = $3
      ORDER BY d.pool, d.odds NULLS LAST`,
    [raceDate, meet, raceNo],
  );
}
