import { query } from "./db";

export type HorseRating = {
  rating1: number | null;
  rating2: number | null;
  rating3: number | null;
  rating4: number | null;
};

/** horse_no 의 최신 레이팅 스냅샷 (rating1~4 = KRA 누적 4 시점, rating4 가 가장 최근). */
export async function getLatestRating(horseNo: string): Promise<HorseRating | null> {
  const rows = await query<HorseRating>(
    `SELECT rating1, rating2, rating3, rating4
       FROM horse_ratings
      WHERE horse_no = $1`,
    [horseNo],
  );
  return rows[0] ?? null;
}

/** 여러 마필의 최신 레이팅을 한 번에 조회 (출마표 한 화면 N마필용). */
export async function getLatestRatingsBulk(
  horseNos: string[],
): Promise<Record<string, HorseRating>> {
  if (horseNos.length === 0) return {};
  const placeholders = horseNos.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await query<HorseRating & { horse_no: string }>(
    `SELECT horse_no, rating1, rating2, rating3, rating4
       FROM horse_ratings
      WHERE horse_no IN (${placeholders})`,
    horseNos,
  );
  return Object.fromEntries(
    rows.map((r) => [
      r.horse_no,
      {
        rating1: r.rating1,
        rating2: r.rating2,
        rating3: r.rating3,
        rating4: r.rating4,
      },
    ]),
  );
}
