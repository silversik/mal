import { query } from "./db";

export type Jockey = {
  jk_no: string;
  jk_name: string;
  meet: string | null;
  birth_date: string | null;
  debut_date: string | null;
  total_race_count: number;
  first_place_count: number;
  second_place_count: number;
  third_place_count: number;
  win_rate: string | null;
};

export type JockeyRaceResult = {
  id: number;
  race_date: string;
  meet: string | null;
  race_no: number;
  rank: number | null;
  horse_name: string;
  horse_no: string;
  record_time: string | null;
};

const JOCKEY_COLUMNS = `
  jk_no, jk_name, meet,
  to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
  to_char(debut_date, 'YYYY-MM-DD') AS debut_date,
  total_race_count, first_place_count, second_place_count,
  third_place_count, win_rate::text
`;

export async function getJockeyByNo(jkNo: string): Promise<Jockey | null> {
  const rows = await query<Jockey>(
    `SELECT ${JOCKEY_COLUMNS} FROM jockeys WHERE jk_no = $1`,
    [jkNo],
  );
  return rows[0] ?? null;
}

export async function countAllJockeys(): Promise<number> {
  const rows = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM jockeys`);
  return Number(rows[0]?.count ?? 0);
}

export async function searchJockeysByName(
  name: string,
  limit = 20,
): Promise<Jockey[]> {
  if (!name.trim()) return [];
  return query<Jockey>(
    `SELECT ${JOCKEY_COLUMNS}
       FROM jockeys
      WHERE jk_name ILIKE $1
      ORDER BY total_race_count DESC
      LIMIT $2`,
    [`%${name.trim()}%`, limit],
  );
}

export async function getAllJockeys(limit = 50): Promise<Jockey[]> {
  return query<Jockey>(
    `SELECT ${JOCKEY_COLUMNS}
       FROM jockeys
      ORDER BY total_race_count DESC
      LIMIT $1`,
    [limit],
  );
}

/**
 * 기수 × 조교사 콤보 적중률.
 * race_results 의 (jockey_name, trainer_name) 으로 group by + 조교사 정보 join.
 * 최소 X 회 이상 동승한 콤보만 의미 있음 — minStarts 미만은 제외.
 */
export type JockeyTrainerCombo = {
  trainer_name: string;
  tr_no: string | null;
  starts: number;
  win: number;
  place: number;
  show: number;
  win_rate: number;
  in_money_rate: number;
};

export async function getJockeyTrainerCombos(
  jkName: string,
  minStarts = 5,
): Promise<JockeyTrainerCombo[]> {
  const rows = await query<{
    trainer_name: string;
    tr_no: string | null;
    starts: number;
    win: number;
    place: number;
    show_: number;
  }>(
    `SELECT rr.trainer_name,
            t.tr_no,
            COUNT(*)::int AS starts,
            SUM(CASE WHEN rr.rank = 1 THEN 1 ELSE 0 END)::int AS win,
            SUM(CASE WHEN rr.rank = 2 THEN 1 ELSE 0 END)::int AS place,
            SUM(CASE WHEN rr.rank = 3 THEN 1 ELSE 0 END)::int AS show_
       FROM race_results rr
       LEFT JOIN trainers t ON t.tr_name = rr.trainer_name
      WHERE rr.jockey_name = $1 AND rr.trainer_name IS NOT NULL
      GROUP BY rr.trainer_name, t.tr_no
     HAVING COUNT(*) >= $2
      ORDER BY COUNT(*) FILTER (WHERE rr.rank = 1) DESC,
               COUNT(*) DESC
      LIMIT 30`,
    [jkName, minStarts],
  );
  return rows.map((r) => {
    const starts = Number(r.starts);
    const win = Number(r.win);
    const place = Number(r.place);
    const show = Number(r.show_);
    return {
      trainer_name: r.trainer_name,
      tr_no: r.tr_no,
      starts,
      win,
      place,
      show,
      win_rate: starts > 0 ? win / starts : 0,
      in_money_rate: starts > 0 ? (win + place + show) / starts : 0,
    };
  });
}

/**
 * 기수의 월별 출전·우승 카운트 (최근 N개월).
 * SVG 차트용 시계열.
 */
export type JockeyMonthlyStat = {
  ym: string; // YYYY-MM
  starts: number;
  win: number;
  place: number;
  show: number;
};

export async function getJockeyMonthlyStats(
  jkName: string,
  months = 12,
): Promise<JockeyMonthlyStat[]> {
  // 최근 N개월 (현재월 포함). 빈 월은 0 으로 채움.
  const rows = await query<{
    ym: string;
    starts: number;
    win: number;
    place: number;
    show_: number;
  }>(
    `WITH months AS (
       SELECT to_char(d, 'YYYY-MM') AS ym
         FROM generate_series(
           date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') - ((($2::int - 1) || ' months')::interval),
           date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul'),
           interval '1 month'
         ) AS d
     ),
     agg AS (
       SELECT to_char(rr.race_date, 'YYYY-MM') AS ym,
              COUNT(*)::int AS starts,
              SUM(CASE WHEN rr.rank = 1 THEN 1 ELSE 0 END)::int AS win,
              SUM(CASE WHEN rr.rank = 2 THEN 1 ELSE 0 END)::int AS place,
              SUM(CASE WHEN rr.rank = 3 THEN 1 ELSE 0 END)::int AS show_
         FROM race_results rr
        WHERE rr.jockey_name = $1
          AND rr.race_date >= (date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') - ((($2::int - 1) || ' months')::interval))::date
        GROUP BY 1
     )
     SELECT m.ym,
            COALESCE(a.starts, 0) AS starts,
            COALESCE(a.win, 0) AS win,
            COALESCE(a.place, 0) AS place,
            COALESCE(a.show_, 0) AS show_
       FROM months m
       LEFT JOIN agg a ON a.ym = m.ym
      ORDER BY m.ym`,
    [jkName, months],
  );
  return rows.map((r) => ({
    ym: r.ym,
    starts: Number(r.starts),
    win: Number(r.win),
    place: Number(r.place),
    show: Number(r.show_),
  }));
}

export async function getRecentRacesByJockey(
  jkName: string,
  limit = 20,
): Promise<JockeyRaceResult[]> {
  return query<JockeyRaceResult>(
    // record_time(NUMERIC) 은 KRA rcTime "1:22.4" 가 float() 파싱 실패로 NULL 인 경우가 많다.
    // 표시용으로는 raw->>'rcTime' (이미 "M:SS.f" 형식) 을 우선 사용하고, 없을 때만 컬럼값.
    `SELECT r.id,
            to_char(r.race_date, 'YYYY-MM-DD') AS race_date,
            r.meet, r.race_no, r.rank,
            h.horse_name, h.horse_no,
            COALESCE(NULLIF(NULLIF(r.raw->>'rcTime', '-'), ''), r.record_time::text) AS record_time
       FROM race_results r
       JOIN horses h ON h.horse_no = r.horse_no
      WHERE r.jockey_name = $1
      ORDER BY r.race_date DESC, r.race_no DESC
      LIMIT $2`,
    [jkName, limit],
  );
}
