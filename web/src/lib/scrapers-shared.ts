// Client-safe: 타입 + 순수 포매터. DB import 금지.

export type ScraperJobRow = {
  job_key: string;
  source: string;
  description: string | null;
  expected_interval_sec: number;
  enabled: boolean;
  last_run_at: string | null;
  last_success_at: string | null;
  last_status: "running" | "success" | "failed" | null;
  last_duration_ms: number | null;
  last_rows_upserted: number | null;
  last_error: string | null;
  consecutive_failures: number;
  since_success_sec: number | null;
};

export type ScraperRunRow = {
  id: number;
  job_key: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "failed";
  rows_upserted: number | null;
  duration_ms: number | null;
  error_message: string | null;
};

const SOURCE_LABEL: Record<string, string> = {
  kra_openapi: "KRA OpenAPI",
  kra_rss: "KRA RSS",
  youtube: "YouTube",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

/** stale = enabled AND (never succeeded OR last_success older than interval*1.5). */
export function isStale(job: ScraperJobRow): boolean {
  if (!job.enabled) return false;
  if (job.since_success_sec === null) return true;
  return job.since_success_sec > job.expected_interval_sec * 1.5;
}

export function formatInterval(sec: number): string {
  if (sec % 86400 === 0) return `${sec / 86400}일`;
  if (sec % 3600 === 0) return `${sec / 3600}시간`;
  if (sec % 60 === 0) return `${sec / 60}분`;
  return `${sec}초`;
}

export function formatDuration(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return `${Math.floor(sec / 86400)}일 전`;
}
