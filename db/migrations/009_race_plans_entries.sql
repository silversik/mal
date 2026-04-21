-- mal.kr: 대상경주 연간계획 (race_plans) + 출전표 (race_entries)
-- Depends on: 001_init.sql (set_updated_at trigger fn), 006_news_image.sql.
--
-- Sources:
--   race_plans   — KRA OpenAPI API40/raceAnnualPlan (대상경주 연간계획, 15059482)
--   race_entries — KRA OpenAPI API26_2/<op> (출전표 상세정보, 15058677)

BEGIN;

-- ============================================================================
-- 1. race_plans : 연간 대상(스테이크) 경주 계획
-- ============================================================================
CREATE TABLE IF NOT EXISTS race_plans (
    id              BIGSERIAL    PRIMARY KEY,
    meet            VARCHAR(20)  NOT NULL,          -- 서울/제주/부경
    year            INT          NOT NULL,
    race_date       DATE,                           -- 미정(TBD)일 수 있음
    race_no         INT,
    race_name       TEXT         NOT NULL,
    grade           VARCHAR(20),                    -- GI / GII / GIII / L / 일반
    distance        INT,
    track_type      VARCHAR(20),                    -- 더트/잔디
    age_cond        VARCHAR(50),                    -- "3세 이상" 등
    prize_1st       BIGINT,                         -- 1착 상금(원)
    total_prize     BIGINT,                         -- 총 상금(원)
    raw             JSONB,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_race_plans UNIQUE (meet, year, race_name)
);

CREATE INDEX IF NOT EXISTS idx_race_plans_date  ON race_plans (race_date);
CREATE INDEX IF NOT EXISTS idx_race_plans_grade ON race_plans (grade);
CREATE INDEX IF NOT EXISTS idx_race_plans_meet_year ON race_plans (meet, year);

DROP TRIGGER IF EXISTS trg_race_plans_updated_at ON race_plans;
CREATE TRIGGER trg_race_plans_updated_at
    BEFORE UPDATE ON race_plans
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- 2. race_entries : 출전표 (예정 경주의 출전 마필)
-- ============================================================================
CREATE TABLE IF NOT EXISTS race_entries (
    id              BIGSERIAL    PRIMARY KEY,
    race_date       DATE         NOT NULL,
    meet            VARCHAR(20)  NOT NULL,
    race_no         INT          NOT NULL,
    horse_no        VARCHAR(20)  NOT NULL,
    chul_no         INT,                            -- 출전번호 (gate #)
    horse_name      VARCHAR(100),
    jk_no           VARCHAR(20),
    jockey_name     VARCHAR(50),
    trainer_name    VARCHAR(50),
    weight          NUMERIC(5, 1),                  -- 마체중(kg)
    age             VARCHAR(10),
    sex             VARCHAR(10),
    rating          INT,
    raw             JSONB,
    fetched_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_race_entries UNIQUE (race_date, meet, race_no, horse_no)
);

CREATE INDEX IF NOT EXISTS idx_race_entries_date      ON race_entries (race_date DESC);
CREATE INDEX IF NOT EXISTS idx_race_entries_date_meet ON race_entries (race_date, meet);
CREATE INDEX IF NOT EXISTS idx_race_entries_horse     ON race_entries (horse_no);

DROP TRIGGER IF EXISTS trg_race_entries_updated_at ON race_entries;
CREATE TRIGGER trg_race_entries_updated_at
    BEFORE UPDATE ON race_entries
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- 3. scraper_jobs seed : 새 job 2개 추가
-- ============================================================================
INSERT INTO scraper_jobs (job_key, source, description, expected_interval_sec) VALUES
    ('sync_race_plan',    'kra_openapi', '대상경주 연간계획 (API40/raceAnnualPlan)',    86400),   -- 1일
    ('sync_race_entries', 'kra_openapi', '이번주 출전표 (API26_2/<op>)',                10800)    -- 3시간
ON CONFLICT (job_key) DO NOTHING;

COMMIT;
