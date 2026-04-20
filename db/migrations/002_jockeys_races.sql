-- mal.kr schema extension: jockeys + races
-- Depends on: 001_init.sql

BEGIN;

-- ============================================================================
-- 1. jockeys : 기수 마스터
-- ============================================================================
CREATE TABLE IF NOT EXISTS jockeys (
    jk_no               VARCHAR(20)  PRIMARY KEY,           -- 기수번호
    jk_name             VARCHAR(50)  NOT NULL,              -- 기수명
    meet                VARCHAR(20),                        -- 소속 경마장 (서울/제주/부경)
    birth_date          DATE,                               -- 생년월일
    debut_date          DATE,                               -- 데뷔일
    total_race_count    INT NOT NULL DEFAULT 0,             -- 통산 출전
    first_place_count   INT NOT NULL DEFAULT 0,             -- 통산 1착
    second_place_count  INT NOT NULL DEFAULT 0,             -- 통산 2착
    third_place_count   INT NOT NULL DEFAULT 0,             -- 통산 3착
    win_rate            NUMERIC(5, 2),                      -- 승률(%)
    raw                 JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jockeys_name ON jockeys (jk_name);
CREATE INDEX IF NOT EXISTS idx_jockeys_meet ON jockeys (meet);

DROP TRIGGER IF EXISTS trg_jockeys_updated_at ON jockeys;
CREATE TRIGGER trg_jockeys_updated_at
    BEFORE UPDATE ON jockeys
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 2. races : 경주(경기) 정보 — 경주 단위 메타데이터
-- ============================================================================
CREATE TABLE IF NOT EXISTS races (
    id                  BIGSERIAL PRIMARY KEY,
    race_date           DATE        NOT NULL,               -- 경주일자
    meet                VARCHAR(20) NOT NULL,               -- 경마장
    race_no             INT         NOT NULL,               -- 경주번호
    race_name           VARCHAR(200),                       -- 경주명
    distance            INT,                                -- 거리(m)
    grade               VARCHAR(50),                        -- 등급
    track_type          VARCHAR(20),                        -- 주로 (잔디/모래)
    track_condition     VARCHAR(20),                        -- 주로 상태 (건조/양호 등)
    entry_count         INT,                                -- 출전두수
    raw                 JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_races UNIQUE (race_date, meet, race_no)
);

CREATE INDEX IF NOT EXISTS idx_races_date ON races (race_date DESC);
CREATE INDEX IF NOT EXISTS idx_races_meet_date ON races (meet, race_date DESC);

-- ============================================================================
-- 3. race_results 에 jockey FK 추가 (nullable — 기존 데이터 보존)
-- ============================================================================
ALTER TABLE race_results
    ADD COLUMN IF NOT EXISTS jk_no VARCHAR(20);

-- FK는 optional: jockeys 테이블에 해당 기수가 아직 없을 수도 있음
-- ALTER TABLE race_results ADD CONSTRAINT fk_race_results_jockey
--     FOREIGN KEY (jk_no) REFERENCES jockeys(jk_no) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_race_results_jk_no ON race_results (jk_no);

COMMIT;
