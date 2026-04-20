-- mal.kr scraper monitoring
-- Depends on: 001_init.sql (set_updated_at trigger fn)
--
-- Tables:
--   scraper_jobs  — job 메타 (주기, 출처, 활성화 여부). 대시보드에서 주기 수정 가능.
--   scraper_runs  — 매 실행 로그 (상태 / 소요시간 / upsert 건수 / 에러).

BEGIN;

-- ============================================================================
-- 1. scraper_jobs : job 메타데이터
-- ============================================================================
CREATE TABLE IF NOT EXISTS scraper_jobs (
    job_key               TEXT         PRIMARY KEY,             -- 예: 'sync_news'
    source                TEXT         NOT NULL,                -- 'kra_openapi' | 'kra_rss' | 'youtube'
    description           TEXT,                                 -- 한글 설명
    expected_interval_sec INT          NOT NULL,                -- 기대 주기(초)
    enabled               BOOLEAN      NOT NULL DEFAULT TRUE,   -- stale 체크/알림 대상 여부
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_scraper_jobs_updated_at ON scraper_jobs;
CREATE TRIGGER trg_scraper_jobs_updated_at
    BEFORE UPDATE ON scraper_jobs
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 2. scraper_runs : 매 실행 로그
-- ============================================================================
CREATE TABLE IF NOT EXISTS scraper_runs (
    id              BIGSERIAL    PRIMARY KEY,
    job_key         TEXT         NOT NULL REFERENCES scraper_jobs(job_key) ON DELETE CASCADE,
    started_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    status          TEXT         NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    rows_upserted   INT,
    duration_ms     INT,
    error_message   TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scraper_runs_job_started ON scraper_runs (job_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraper_runs_started     ON scraper_runs (started_at DESC);

-- ============================================================================
-- 3. seed : 기본 job 메타 (주기는 추후 대시보드에서 수정 가능)
-- ============================================================================
INSERT INTO scraper_jobs (job_key, source, description, expected_interval_sec) VALUES
    ('sync_news',            'kra_rss',     'KRA 공지/뉴스 RSS',              1800),    -- 30분
    ('sync_videos',          'youtube',     'KRBC 유튜브 최신 영상',           10800),   -- 3시간
    ('sync_races_today',     'kra_openapi', '오늘 경주결과 (3개 경마장)',       86400),   -- 1일
    ('sync_jockeys',         'kra_openapi', '현직 기수정보',                   86400),   -- 1일
    ('sync_horses_backfill', 'kra_openapi', '마필 raw 백필 (신규 마필 enrich)', 86400)    -- 1일
ON CONFLICT (job_key) DO NOTHING;

COMMIT;
