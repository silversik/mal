import { query } from "./db";

export type Trainer = {
  tr_no: string;
  tr_name: string;
  tr_name_en: string | null;
  meet: string | null;
  birth_date: string | null;
  debut_date: string | null;
  total_race_count: number;
  first_place_count: number;
  second_place_count: number;
  third_place_count: number;
  win_rate: string | null;
};

export type TrainerRaceResult = {
  id: number;
  race_date: string;
  meet: string | null;
  race_no: number;
  rank: number | null;
  horse_name: string;
  horse_no: string;
  jockey_name: string | null;
  record_time: string | null;
};

const TRAINER_COLUMNS = `
  tr_no, tr_name, tr_name_en, meet,
  to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
  to_char(debut_date, 'YYYY-MM-DD') AS debut_date,
  total_race_count, first_place_count, second_place_count,
  third_place_count, win_rate::text
`;

export async function getTrainerByNo(trNo: string): Promise<Trainer | null> {
  const rows = await query<Trainer>(
    `SELECT ${TRAINER_COLUMNS} FROM trainers WHERE tr_no = $1`,
    [trNo],
  );
  return rows[0] ?? null;
}

export async function getAllTrainers(limit = 100): Promise<Trainer[]> {
  return query<Trainer>(
    `SELECT ${TRAINER_COLUMNS}
       FROM trainers
      ORDER BY first_place_count DESC, total_race_count DESC
      LIMIT $1`,
    [limit],
  );
}

export async function getTrainerCount(): Promise<number> {
  const rows = await query<{ c: string }>(`SELECT count(*)::text AS c FROM trainers`);
  return Number(rows[0]?.c ?? 0);
}

export async function searchTrainersByName(name: string, limit = 20): Promise<Trainer[]> {
  if (!name.trim()) return [];
  return query<Trainer>(
    `SELECT ${TRAINER_COLUMNS}
       FROM trainers
      WHERE tr_name ILIKE $1
      ORDER BY total_race_count DESC
      LIMIT $2`,
    [`%${name.trim()}%`, limit],
  );
}

export async function getRecentRacesByTrainer(
  trName: string,
  limit = 20,
): Promise<TrainerRaceResult[]> {
  return query<TrainerRaceResult>(
    `SELECT r.id,
            to_char(r.race_date, 'YYYY-MM-DD') AS race_date,
            r.meet, r.race_no, r.rank,
            h.horse_name, h.horse_no,
            r.jockey_name, r.record_time::text
       FROM race_results r
       JOIN horses h ON h.horse_no = r.horse_no
      WHERE r.trainer_name = $1
      ORDER BY r.race_date DESC, r.race_no DESC
      LIMIT $2`,
    [trName, limit],
  );
}

/**
 * race_results 의 trainer_name 문자열 → trainers.tr_no 매핑.
 * race 페이지에서 출전 마필별 trainer 링크용.
 */
export async function getTrainerNoMap(names: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return {};
  const placeholders = unique.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await query<{ tr_name: string; tr_no: string }>(
    `SELECT tr_name, tr_no FROM trainers WHERE tr_name IN (${placeholders})`,
    unique,
  );
  return Object.fromEntries(rows.map((r) => [r.tr_name, r.tr_no]));
}
