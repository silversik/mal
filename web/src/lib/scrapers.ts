import { query } from "./db";
import type { ScraperJobRow, ScraperRunRow } from "./scrapers-shared";

export * from "./scrapers-shared";

/**
 * Aggregate one row per job with its latest run, last success, and a
 * consecutive-failure count (runs since the last success).
 */
export async function listScraperJobs(): Promise<ScraperJobRow[]> {
  const sql = `
    WITH last_run AS (
      SELECT DISTINCT ON (job_key)
             job_key,
             started_at   AS last_run_at,
             status       AS last_status,
             duration_ms  AS last_duration_ms,
             rows_upserted AS last_rows_upserted,
             error_message AS last_error
        FROM scraper_runs
       ORDER BY job_key, started_at DESC
    ),
    last_success AS (
      SELECT job_key, MAX(finished_at) AS last_success_at
        FROM scraper_runs
       WHERE status = 'success'
       GROUP BY job_key
    ),
    fails AS (
      SELECT r.job_key, COUNT(*)::int AS consecutive_failures
        FROM scraper_runs r
        LEFT JOIN last_success ls ON ls.job_key = r.job_key
       WHERE r.status = 'failed'
         AND (ls.last_success_at IS NULL OR r.started_at > ls.last_success_at)
       GROUP BY r.job_key
    )
    SELECT j.job_key,
           j.source,
           j.description,
           j.expected_interval_sec,
           j.enabled,
           to_char(lr.last_run_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SSOF') AS last_run_at,
           to_char(ls.last_success_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SSOF') AS last_success_at,
           lr.last_status,
           lr.last_duration_ms,
           lr.last_rows_upserted,
           lr.last_error,
           COALESCE(f.consecutive_failures, 0) AS consecutive_failures,
           CASE WHEN ls.last_success_at IS NULL THEN NULL
                ELSE EXTRACT(EPOCH FROM (NOW() - ls.last_success_at))::int
           END AS since_success_sec
      FROM scraper_jobs j
      LEFT JOIN last_run     lr ON lr.job_key = j.job_key
      LEFT JOIN last_success ls ON ls.job_key = j.job_key
      LEFT JOIN fails        f  ON f.job_key  = j.job_key
     ORDER BY j.source, j.job_key
  `;
  return query<ScraperJobRow>(sql);
}

export async function listRecentRuns(
  jobKey: string,
  limit = 20,
): Promise<ScraperRunRow[]> {
  return query<ScraperRunRow>(
    `SELECT id, job_key,
            to_char(started_at  AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SSOF') AS started_at,
            to_char(finished_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SSOF') AS finished_at,
            status, rows_upserted, duration_ms, error_message
       FROM scraper_runs
      WHERE job_key = $1
      ORDER BY started_at DESC
      LIMIT $2`,
    [jobKey, limit],
  );
}

export async function updateJobInterval(
  jobKey: string,
  intervalSec: number,
): Promise<void> {
  await query(
    `UPDATE scraper_jobs SET expected_interval_sec = $2 WHERE job_key = $1`,
    [jobKey, intervalSec],
  );
}

export async function updateJobEnabled(
  jobKey: string,
  enabled: boolean,
): Promise<void> {
  await query(
    `UPDATE scraper_jobs SET enabled = $2 WHERE job_key = $1`,
    [jobKey, enabled],
  );
}
