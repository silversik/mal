import { query } from "./db";

export type HorseRating = {
  rating1: number | null;
  rating2: number | null;
  rating3: number | null;
  rating4: number | null;
};

export type HorseRatingPoint = HorseRating & {
  snapshot_date: string;  // 'YYYY-MM-DD'
};

/**
 * horse_no 의 최신 레이팅 스냅샷 (rating1~4 = KRA 누적 4 시점, rating4 가 가장 최근).
 *
 * 016 마이그레이션 이후 horse_ratings PK = (horse_no, snapshot_date) 시계열.
 * 가장 최근 snapshot_date 의 row 만 반환.
 */
export async function getLatestRating(horseNo: string): Promise<HorseRating | null> {
  const rows = await query<HorseRating>(
    `SELECT rating1, rating2, rating3, rating4
       FROM horse_ratings
      WHERE horse_no = $1
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    [horseNo],
  );
  return rows[0] ?? null;
}

/**
 * horse_no 의 전체 snapshot 시계열 (시간 오름차순). 차트/변화 추적용.
 * 한 마필이 한 번도 안 잡혔으면 빈 배열.
 */
export async function getRatingHistory(
  horseNo: string,
  limit = 52,
): Promise<HorseRatingPoint[]> {
  return query<HorseRatingPoint>(
    `SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS snapshot_date,
            rating1, rating2, rating3, rating4
       FROM horse_ratings
      WHERE horse_no = $1
      ORDER BY snapshot_date DESC
      LIMIT $2`,
    [horseNo, limit],
  );
}

/**
 * 여러 마필의 최신 레이팅을 한 번에 조회 (출마표 한 화면 N마필용).
 * DISTINCT ON (horse_no) ORDER BY horse_no, snapshot_date DESC — 인덱스
 * `(horse_no, snapshot_date DESC)` 로 lookup 1회/마필.
 */
export async function getLatestRatingsBulk(
  horseNos: string[],
): Promise<Record<string, HorseRating>> {
  if (horseNos.length === 0) return {};
  const placeholders = horseNos.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await query<HorseRating & { horse_no: string }>(
    `SELECT DISTINCT ON (horse_no)
            horse_no, rating1, rating2, rating3, rating4
       FROM horse_ratings
      WHERE horse_no IN (${placeholders})
      ORDER BY horse_no, snapshot_date DESC`,
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
