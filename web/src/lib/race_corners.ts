import { query } from "./db";

/**
 * 경주 통과순위 (race_result_corners). API4_2 적재 후 페이스 맵에 사용.
 * 데이터 없으면 빈 배열 반환 — UI 에서 자동 미노출.
 */
export type CornerRow = {
  horse_no: string;
  horse_name: string;
  rank: number | null;
  ord_s1f: number | null;
  ord_1c: number | null;
  ord_2c: number | null;
  ord_3c: number | null;
  ord_4c: number | null;
  ord_g3f: number | null;
  ord_g1f: number | null;
};

export async function getCornersForRace(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<CornerRow[]> {
  // race_result_corners 테이블이 아직 없을 수 있다 (마이그레이션 미적용 환경) —
  // information_schema 확인 후 안전하게 빈 배열 반환.
  const exists = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_name = 'race_result_corners'
     ) AS exists`,
  );
  if (!exists[0]?.exists) return [];

  return query<CornerRow>(
    `SELECT c.horse_no, h.horse_name, rr.rank,
            c.ord_s1f, c.ord_1c, c.ord_2c, c.ord_3c, c.ord_4c,
            c.ord_g3f, c.ord_g1f
       FROM race_result_corners c
       JOIN horses h ON h.horse_no = c.horse_no
       LEFT JOIN race_results rr
         ON rr.race_date = c.race_date
        AND rr.meet      = c.meet
        AND rr.race_no   = c.race_no
        AND rr.horse_no  = c.horse_no
      WHERE c.race_date = $1::date AND c.meet = $2 AND c.race_no = $3
      ORDER BY rr.rank NULLS LAST, h.horse_name`,
    [raceDate, meet, raceNo],
  );
}
