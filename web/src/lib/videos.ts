import { query } from "./db";
import type { VideoItem } from "./video-helpers";

export type { VideoItem } from "./video-helpers";
export { formatDuration, youtubeEmbedUrl, youtubeWatchUrl } from "./video-helpers";

const VIDEO_COLUMNS = `
  id, video_id, channel_id, channel_title, title, description,
  thumbnail_url, duration_sec, view_count,
  to_char(published_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SSOF') AS published_at
`;

export async function getLatestVideos(limit = 12, offset = 0): Promise<VideoItem[]> {
  return query<VideoItem>(
    `SELECT ${VIDEO_COLUMNS}
       FROM kra_videos
      ORDER BY published_at DESC, id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
}

export async function countVideos(): Promise<number> {
  const rows = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM kra_videos`);
  return Number(rows[0]?.count ?? 0);
}

/**
 * 특정 경주에 해당하는 KRBC 영상(있으면) — 제목 파싱 결과로 결정적 매칭.
 * KRBC는 한 경주당 1개 업로드가 일반적이지만 중복 대비 최신 1건 반환.
 */
export async function getRaceVideo(
  raceDate: string,
  meet: string,
  raceNo: number,
): Promise<VideoItem | null> {
  const rows = await query<VideoItem>(
    `SELECT ${VIDEO_COLUMNS}
       FROM kra_videos
      WHERE race_date = $1::date
        AND meet = $2
        AND race_no = $3
      ORDER BY published_at DESC, id DESC
      LIMIT 1`,
    [raceDate, meet, raceNo],
  );
  return rows[0] ?? null;
}
