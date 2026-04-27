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

export type RaceKey = `${string}|${string}|${number}`;

export function raceKey(raceDate: string, meet: string, raceNo: number): RaceKey {
  return `${raceDate}|${meet}|${raceNo}`;
}

/**
 * 여러 경주에 대한 영상을 한 번의 쿼리로 조회.
 * 반환값: raceKey → VideoItem (영상 없는 경주는 포함되지 않음).
 */
export async function getVideosForRaces(
  races: Array<{ race_date: string; meet: string | null; race_no: number }>,
): Promise<Map<RaceKey, VideoItem>> {
  const valid = races.filter((r) => r.race_date && r.meet && r.race_no);
  if (valid.length === 0) return new Map();

  // unnest를 통한 배치 조회 — N+1 없이 한 쿼리로 처리.
  const dates = valid.map((r) => r.race_date);
  const meets = valid.map((r) => r.meet!);
  const nos   = valid.map((r) => r.race_no);

  const rows = await query<VideoItem & { race_date: string; meet: string; race_no: number }>(
    `SELECT DISTINCT ON (v.race_date, v.meet, v.race_no)
            ${VIDEO_COLUMNS.trim()},
            v.race_date::text, v.meet, v.race_no
       FROM kra_videos v
       JOIN unnest($1::date[], $2::text[], $3::int[]) AS t(rd, m, rn)
         ON v.race_date = t.rd AND v.meet = t.m AND v.race_no = t.rn
      ORDER BY v.race_date, v.meet, v.race_no, v.published_at DESC, v.id DESC`,
    [dates, meets, nos],
  );

  const map = new Map<RaceKey, VideoItem>();
  for (const r of rows) {
    map.set(raceKey(r.race_date, r.meet, r.race_no), r);
  }
  return map;
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
