-- mal.kr initial schema
-- Target: PostgreSQL 16
-- Source: KRA OpenAPI (data.go.kr)
--
-- Tables:
--   horses        — 마필 마스터 (API42_1 · 마필종합 상세정보)
--   race_results  — 경주 결과 (경주성적정보 / 경주마별 1년간 전적)

BEGIN;

-- ============================================================================
-- 1. horses : 마필 마스터
-- ============================================================================
CREATE TABLE IF NOT EXISTS horses (
    horse_no            VARCHAR(20)  PRIMARY KEY,           -- 마필고유번호 (hrNo)
    horse_name          VARCHAR(100) NOT NULL,              -- 마명 (hrName)
    country             VARCHAR(50),                        -- 산지 (name)
    sex                 VARCHAR(10),                        -- 성별 (sex)
    birth_date          DATE,                               -- 생년월일 (birthday)
    sire_name           VARCHAR(100),                       -- 부마명 (faHrName)
    dam_name            VARCHAR(100),                       -- 모마명 (moHrName)
    total_race_count    INT NOT NULL DEFAULT 0,             -- 통산출전횟수 (rcCntT)
    first_place_count   INT NOT NULL DEFAULT 0,             -- 1착 횟수 (ord1CntT)
    raw                 JSONB,                              -- 원본 응답 보존(필드 추가 대비)
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_horses_name       ON horses (horse_name);
CREATE INDEX IF NOT EXISTS idx_horses_sire       ON horses (sire_name);
CREATE INDEX IF NOT EXISTS idx_horses_dam        ON horses (dam_name);
CREATE INDEX IF NOT EXISTS idx_horses_birth_date ON horses (birth_date);

-- ============================================================================
-- 2. race_results : 경주별 말의 기록
-- ============================================================================
CREATE TABLE IF NOT EXISTS race_results (
    id               BIGSERIAL PRIMARY KEY,
    horse_no         VARCHAR(20) NOT NULL REFERENCES horses(horse_no) ON DELETE CASCADE,
    race_date        DATE        NOT NULL,                  -- 경주 일자 (rcDate)
    meet             VARCHAR(20),                           -- 경마장 (서울/제주/부경)
    race_no          INT         NOT NULL,                  -- 경주 번호 (rcNo)
    track_condition  VARCHAR(20),                           -- 주로 상태
    rank             INT,                                   -- 확정 순위 (ord)
    record_time      NUMERIC(6, 2),                         -- 경주 기록(초)
    weight           NUMERIC(5, 1),                         -- 마체중(kg)
    jockey_name      VARCHAR(50),                           -- 기수명
    trainer_name     VARCHAR(50),                           -- 조교사명
    raw              JSONB,                                 -- 원본 응답 보존
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 같은 말이 같은 날 같은 경마장 같은 경주에 중복 insert 되지 않도록
    CONSTRAINT uq_race_results UNIQUE (horse_no, race_date, meet, race_no)
);

CREATE INDEX IF NOT EXISTS idx_race_results_horse_date ON race_results (horse_no, race_date DESC);
CREATE INDEX IF NOT EXISTS idx_race_results_date       ON race_results (race_date DESC);
CREATE INDEX IF NOT EXISTS idx_race_results_jockey     ON race_results (jockey_name);

-- ============================================================================
-- updated_at 자동 갱신 트리거 (horses)
-- ============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_horses_updated_at ON horses;
CREATE TRIGGER trg_horses_updated_at
    BEFORE UPDATE ON horses
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
