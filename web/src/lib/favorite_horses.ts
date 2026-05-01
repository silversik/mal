import { query } from "@/lib/db";

export async function isHorseFavorited(
  userId: string,
  horseNo: string,
): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM user_favorite_horses
       WHERE user_id = $1::bigint AND horse_no = $2
     ) AS exists`,
    [userId, horseNo],
  );
  return rows[0]?.exists ?? false;
}

/** 토글 — 이미 즐겨찾기면 DELETE, 아니면 INSERT. 결과 상태 반환. */
export async function toggleHorseFavorite(
  userId: string,
  horseNo: string,
): Promise<{ favorited: boolean }> {
  const rows = await query<{ inserted: boolean }>(
    `WITH del AS (
       DELETE FROM user_favorite_horses
        WHERE user_id = $1::bigint AND horse_no = $2
        RETURNING 1
     ),
     ins AS (
       INSERT INTO user_favorite_horses (user_id, horse_no)
       SELECT $1::bigint, $2
        WHERE NOT EXISTS (SELECT 1 FROM del)
       RETURNING 1
     )
     SELECT EXISTS(SELECT 1 FROM ins) AS inserted`,
    [userId, horseNo],
  );
  return { favorited: rows[0]?.inserted ?? false };
}
