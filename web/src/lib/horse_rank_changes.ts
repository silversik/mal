import { query } from "./db";

/**
 * 마필 등급변동 이벤트 — horse_rank_changes 테이블 (KRA raceHorseRatingChangeInfo_2).
 *
 * "등급" 은 KRA 라벨 (국1~국6 등) — numeric rating (B1, horse_ratings) 와는 별개.
 * before_rank → after_rank 의 형태 변화를 시간순으로 표시.
 */
export type HorseRankChange = {
  st_date: string;            // YYYY-MM-DD 적용일
  sp_date: string | null;     // 시행일 (대부분 null)
  before_rank: string | null;
  after_rank: string | null;
  blood: string | null;
};

/** 한 마필의 등급변동 이력 (최신 → 과거 순). */
export async function getHorseRankChanges(
  horseNo: string,
  limit = 10,
): Promise<HorseRankChange[]> {
  return query<HorseRankChange>(
    `SELECT to_char(st_date, 'YYYY-MM-DD') AS st_date,
            to_char(sp_date, 'YYYY-MM-DD') AS sp_date,
            before_rank, after_rank, blood
       FROM horse_rank_changes
      WHERE horse_no = $1
      ORDER BY st_date DESC
      LIMIT $2`,
    [horseNo, limit],
  );
}
