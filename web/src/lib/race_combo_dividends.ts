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
 * 번호 1~12) 이지 마등록번호가 아니다. 두 데이터 소스 양쪽을 COALESCE:
 *   - race_entries.chul_no       — 출마표 (예정/당일 경주, 결과 전)
 *   - race_results.raw->>'chulNo' — 결과 (확정 후, 복식배당과 동시에 존재)
 * 복식배당은 결과 확정 후만 존재하므로 race_results 가 주 소스.
 */
export async function getRaceComboDividends(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<RaceComboDividend[]> {
  return query<RaceComboDividend>(
    // chul_map 은 chul_no 1건당 정확히 1행이어야 함 — race_entries 와 race_results
    // 양쪽에 같은 chul_no 가 있으면 (당일 경기 = 둘 다 적재) UNION ALL 이 중복을
    // 만들어 LEFT JOIN m1·m2·m3 가 2x~8x 로 곱해지는 사고가 있었다 (5/9 EXA 72→288,
    // TLA 84→672). DISTINCT ON 으로 chul_no 당 1행 보장, 결과 우선(prio=1).
    `WITH chul_map AS (
        SELECT DISTINCT ON (chul_no_text)
               chul_no_text AS chul_no, horse_name
          FROM (
              SELECT r.raw->>'chulNo' AS chul_no_text, h.horse_name, 1 AS prio
                FROM race_results r
                LEFT JOIN horses h ON h.horse_no = r.horse_no
               WHERE r.race_date = $1 AND r.meet = $2 AND r.race_no = $3
                 AND r.raw IS NOT NULL
              UNION ALL
              SELECT chul_no::text AS chul_no_text, horse_name, 2 AS prio
                FROM race_entries
               WHERE race_date = $1 AND meet = $2 AND race_no = $3
          ) u
         WHERE chul_no_text IS NOT NULL AND chul_no_text <> ''
         ORDER BY chul_no_text, prio
     )
     SELECT
        d.pool,
        d.horse_no_1,
        d.horse_no_2,
        d.horse_no_3,
        m1.horse_name AS horse_name_1,
        m2.horse_name AS horse_name_2,
        m3.horse_name AS horse_name_3,
        d.odds::text AS odds
       FROM race_combo_dividends d
       LEFT JOIN chul_map m1 ON m1.chul_no = d.horse_no_1
       LEFT JOIN chul_map m2 ON m2.chul_no = d.horse_no_2
       LEFT JOIN chul_map m3 ON m3.chul_no = d.horse_no_3
      WHERE d.race_date = $1 AND d.meet = $2 AND d.race_no = $3
      ORDER BY d.pool, d.odds NULLS LAST`,
    [raceDate, meet, raceNo],
  );
}
