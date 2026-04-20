// Client-safe helpers and types for KRBC YouTube videos.
// IMPORTANT: this file must NOT import any server-only modules (e.g. `pg`).
// Server-side data fetching lives in `lib/videos.ts`.

export type VideoItem = {
  id: number;
  video_id: string;
  channel_id: string;
  channel_title: string | null;
  title: string;
  description: string | null;
  thumbnail_url: string;
  duration_sec: number | null;
  view_count: number | null;
  published_at: string;
};

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function youtubeEmbedUrl(videoId: string): string {
  // youtube-nocookie.com → 사용자 추적 최소화
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`;
}

export function formatDuration(sec: number | null): string {
  if (!sec || sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
