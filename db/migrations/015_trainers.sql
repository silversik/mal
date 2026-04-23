-- mal.kr: 조교사 마스터
-- Source: KRA OpenAPI dataset 15130588 — "조교사정보_영문추가" (API308)
--   현직 조교사 프로필 + 통산전적 + 영문명. jockeys 테이블과 동일한 형태.
-- Depends on: 001_init.sql (set_updated_at trigger fn).

BEGIN;

CREATE TABLE IF NOT EXISTS trainers (
    tr_no               VARCHAR(20)  PRIMARY KEY,           -- 조교사번호 (trNo)
    tr_name             VARCHAR(50)  NOT NULL,              -- 조교사명 (trName)
    tr_name_en          VARCHAR(100),                       -- 영문명 (영문 추가본 핵심 컬럼)
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

CREATE INDEX IF NOT EXISTS idx_trainers_name ON trainers (tr_name);
CREATE INDEX IF NOT EXISTS idx_trainers_meet ON trainers (meet);

DROP TRIGGER IF EXISTS trg_trainers_updated_at ON trainers;
CREATE TRIGGER trg_trainers_updated_at
    BEFORE UPDATE ON trainers
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- race_results 에 조교사 FK 추가 (nullable — 기존 데이터 보존, trainer_name 문자열은 그대로 유지).
ALTER TABLE race_results
    ADD COLUMN IF NOT EXISTS tr_no VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_race_results_tr_no ON race_results (tr_no);


-- scraper_jobs seed 은 통합 대시보드(crawler 스키마)에서 관리 — mal_app 은 권한 없음.
-- JOB_CATALOG + `register-dashboard-jobs` CLI 가 idempotent 등록.

COMMIT;
