import { query } from "./db";

export type RankingScope = "year" | "ytd" | "all";
export type RankingEntity = "horse" | "jockey" | "trainer";

export type RankingRow = {
  no: string;
  name: string;
  starts: number;
  win: number;
  place: number;
  show: number;
  win_rate: number;
};

/**
 * 시즌 랭킹 — 연도(year) / 올해 누적(ytd) / 통산(all) 토글.
 * race_results 의 1-2-3 카운트 기준.
 *
 * - horse:    horses 마스터 join (마명·마번)
 * - jockey:   jockeys 마스터 join (jk_name 매칭, jk_no 노출)
 * - trainer:  trainers 마스터 join (tr_name 매칭, tr_no 노출)
 *
 * minStarts 미만 row 제외 (기수·조교사: 통산 50, 연 20; 마필: 연 3, 통산 5).
 */
export async function getRanking(
  entity: RankingEntity,
  scope: RankingScope,
  year: number,
  limit = 50,
): Promise<RankingRow[]> {
  const yearFilter =
    scope === "all" ? "" : "AND EXTRACT(YEAR FROM rr.race_date) = $1";
  const params: unknown[] = scope === "all" ? [] : [year];

  if (entity === "horse") {
    const minStarts = scope === "all" ? 5 : 3;
    return query<RankingRow>(
      `SELECT h.horse_no AS no, h.horse_name AS name,
              COUNT(*)::int AS starts,
              SUM(CASE WHEN rr.rank = 1 THEN 1 ELSE 0 END)::int AS win,
              SUM(CASE WHEN rr.rank = 2 THEN 1 ELSE 0 END)::int AS place,
              SUM(CASE WHEN rr.rank = 3 THEN 1 ELSE 0 END)::int AS show,
              CASE WHEN COUNT(*) = 0 THEN 0
                   ELSE SUM(CASE WHEN rr.rank = 1 THEN 1 ELSE 0 END)::float / COUNT(*) END AS win_rate
         FROM race_results rr
         JOIN horses h ON h.horse_no = rr.horse_no
        WHERE rr.horse_no IS NOT NULL ${yearFilter}
        GROUP BY h.horse_no, h.horse_name
       HAVING COUNT(*) >= ${minStarts}
        ORDER BY win DESC, starts DESC
        LIMIT ${limit}`,
      params,
    );
  }

  if (entity === "jockey") {
    const minStarts = scope === "all" ? 50 : 20;
    return query<RankingRow>(
      `SELECT COALESCE(j.jk_no, '') AS no, rr.jockey_name AS name,
              COUNT(*)::int AS starts,
              SUM(CASE WHEN rr.rank = 1 THEN 1 ELSE 0 END)::int AS win,
              SUM(CASE WHEN rr.rank = 2 THEN 1 ELSE 0 END)::int AS place,
              SUM(CASE WHEN rr.rank = 3 THEN 1 ELSE 0 END)::int AS show,
              CASE WHEN COUNT(*) = 0 THEN 0
                   ELSE SUM(CASE WHEN rr.rank = 1 THEN 1 ELSE 0 END)::float / COUNT(*) END AS win_rate
         FROM race_results rr
         LEFT JOIN jockeys j ON j.jk_name = rr.jockey_name
        WHERE rr.jockey_name IS NOT NULL ${yearFilter}
        GROUP BY rr.jockey_name, j.jk_no
       HAVING COUNT(*) >= ${minStarts}
        ORDER BY win DESC, starts DESC
        LIMIT ${limit}`,
      params,
    );
  }

  // trainer
  const minStarts = scope === "all" ? 50 : 20;
  return query<RankingRow>(
    `SELECT COALESCE(t.tr_no, '') AS no, rr.trainer_name AS name,
            COUNT(*)::int AS starts,
            SUM(CASE WHEN rr.rank = 1 THEN 1 ELSE 0 END)::int AS win,
            SUM(CASE WHEN rr.rank = 2 THEN 1 ELSE 0 END)::int AS place,
            SUM(CASE WHEN rr.rank = 3 THEN 1 ELSE 0 END)::int AS show,
            CASE WHEN COUNT(*) = 0 THEN 0
                 ELSE SUM(CASE WHEN rr.rank = 1 THEN 1 ELSE 0 END)::float / COUNT(*) END AS win_rate
       FROM race_results rr
       LEFT JOIN trainers t ON t.tr_name = rr.trainer_name
      WHERE rr.trainer_name IS NOT NULL ${yearFilter}
      GROUP BY rr.trainer_name, t.tr_no
     HAVING COUNT(*) >= ${minStarts}
      ORDER BY win DESC, starts DESC
      LIMIT ${limit}`,
    params,
  );
}
