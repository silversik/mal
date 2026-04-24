import { query } from "./db";

/**
 * 연간 대상경주(특별/대상) 계획 — race_plans 테이블 (KRA API40 기반).
 *
 * KRA 원본에 race_date / 상금이 비어있는 해가 많아 `race_date`, `prize_1st`,
 * `total_prize` 는 nullable. 그레이드(G1/G2/G3/L) 는 `race_name` 내
 * `(G1)`/`(G2)`/`(G3)`/`(L)`/`(특)` 마커에서 추출.
 */
export type RacePlan = {
  id: number;
  meet: string;
  year: number;
  race_date: string | null;
  race_no: number | null;
  race_name: string;
  grade: string | null;       // 대상/특별
  tier: Tier | null;          // name 에서 파싱한 G1/G2/G3/L/특
  distance: number | null;
  track_type: string | null;
  age_cond: string | null;
  prize_1st: number | null;
  total_prize: number | null;
};

export type Tier = "G1" | "G2" | "G3" | "L" | "특";
export const TIER_ORDER: Tier[] = ["G1", "G2", "G3", "L", "특"];

/** race_name 내 괄호 마커에서 tier 추출. */
function parseTier(raceName: string): Tier | null {
  const m = raceName.match(/\((G[123]|L|특)\)/);
  return m ? (m[1] as Tier) : null;
}

export async function listRacePlans(opts: {
  year?: number;
  meet?: string;
} = {}): Promise<RacePlan[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.year != null) {
    params.push(opts.year);
    where.push(`year = $${params.length}`);
  }
  if (opts.meet) {
    params.push(opts.meet);
    where.push(`meet = $${params.length}`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await query<Omit<RacePlan, "tier">>(
    `SELECT id, meet, year,
            to_char(race_date, 'YYYY-MM-DD') AS race_date,
            race_no, race_name, grade, distance, track_type,
            age_cond, prize_1st, total_prize
       FROM race_plans
       ${whereSql}
       ORDER BY race_date NULLS LAST, meet, race_name`,
    params,
  );
  return rows.map((r) => ({ ...r, tier: parseTier(r.race_name) }));
}

/** 수집된 연도 목록 (최신 → 과거). 필터 셀렉터용. */
export async function listRacePlanYears(): Promise<number[]> {
  const rows = await query<{ year: number }>(
    `SELECT DISTINCT year FROM race_plans ORDER BY year DESC`,
  );
  return rows.map((r) => r.year);
}
