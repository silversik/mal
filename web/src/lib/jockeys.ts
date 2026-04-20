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

export async function getRecentRacesByJockey(
  jkName: string,
  limit = 20,
): Promise<JockeyRaceResult[]> {
  return query<JockeyRaceResult>(
    `SELECT r.id,
            to_char(r.race_date, 'YYYY-MM-DD') AS race_date,
            r.meet, r.race_no, r.rank,
            h.horse_name, h.horse_no,
            r.record_time::text
       FROM race_results r
       JOIN horses h ON h.horse_no = r.horse_no
      WHERE r.jockey_name = $1
      ORDER BY r.race_date DESC, r.race_no DESC
      LIMIT $2`,
    [jkName, limit],
  );
}
