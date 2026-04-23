-- mal.kr: 마주 마스터
-- Source: KRA OpenAPI dataset 15130589 — "마주정보_영문추가" (API309)
--   현직 마주 프로필 + 통산전적 + 영문명. trainers/jockeys 테이블 패턴 미러.
--   ※ 마주는 개인+법인 혼재 — 한자/영문 회사명이 들어올 수 있음.
-- Depends on: 001_init.sql (set_updated_at trigger fn).

BEGIN;

CREATE TABLE IF NOT EXISTS owners (
    ow_no               VARCHAR(20)  PRIMARY KEY,           -- 마주번호 (owNo)
    ow_name             VARCHAR(100) NOT NULL,              -- 마주명/법인명 (owName)
    ow_name_en          VARCHAR(200),                       -- 영문명 (영문 추가본 핵심 컬럼)
    meet                VARCHAR(20),                        -- 소속 경마장 (서울/제주/부산경남)
    reg_date            DATE,                               -- 마주등록일 (있으면)
    total_race_count    INT NOT NULL DEFAULT 0,             -- 통산 출전 (보유마 누적)
    first_place_count   INT NOT NULL DEFAULT 0,             -- 통산 1착
    second_place_count  INT NOT NULL DEFAULT 0,             -- 통산 2착
    third_place_count   INT NOT NULL DEFAULT 0,             -- 통산 3착
    win_rate            NUMERIC(5, 2),                      -- 승률(%)
    raw                 JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owners_name ON owners (ow_name);
CREATE INDEX IF NOT EXISTS idx_owners_meet ON owners (meet);

DROP TRIGGER IF EXISTS trg_owners_updated_at ON owners;
CREATE TRIGGER trg_owners_updated_at
    BEFORE UPDATE ON owners
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- horses 에 마주 FK 추가 (nullable — 기존 데이터 보존, raw->>'owNo' 가 source).
-- 기존 horses.raw 에 owNo 가 있는 행은 백필 1회로 ow_no 채우면 됨.
ALTER TABLE horses
    ADD COLUMN IF NOT EXISTS ow_no VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_horses_ow_no ON horses (ow_no);


-- scraper_jobs seed 은 통합 대시보드(crawler 스키마)에서 관리 — mal_app 은 권한 없음.
-- JOB_CATALOG + `register-dashboard-jobs` CLI 가 idempotent 등록.

COMMIT;
