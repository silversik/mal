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
