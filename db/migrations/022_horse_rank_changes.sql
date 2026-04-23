-- mal.kr: 경주마 등급변동 이벤트 로그
-- Source: KRA OpenAPI dataset 15058076 / raceHorseRatingChangeInfo_2
--   (KRA 가 endpoint family 와 operation 이름을 동일하게 사용 — API#### prefix 없음)
--
-- 응답 필드 (2026-04-23 실측):
--   stDate (적용일, YYYYMMDD), spDate (시행일, 대부분 "-"),
--   meet (한글), hrNo, hrName, blood (혈통, 예 "더러브렛"),
--   beforeRank (변경 전 등급, 예 "국6"), rank (변경 후 등급, 예 "국5")
--
-- "등급" 은 numeric rating 이 아니라 KRA 등급체계 (국1~국6, 혼1~혼6 등) 라벨.
-- 같은 마필이 같은 날 두 번 변동되는 경우는 매우 드물므로 (horse_no, st_date) UNIQUE.
-- 만약 같은 날 중복 등장하면 sync 단계에서 마지막 row 만 살림 (가장 최근 reason).
--
-- Depends on: 001_init.sql (set_updated_at trigger fn).

BEGIN;

CREATE TABLE IF NOT EXISTS horse_rank_changes (
    id            BIGSERIAL    PRIMARY KEY,
    horse_no      VARCHAR(20)  NOT NULL,
    st_date       DATE         NOT NULL,           -- 적용일

    horse_name    VARCHAR(100),
    meet          VARCHAR(20),                     -- 서울/제주/부경
    blood         VARCHAR(40),                     -- 혈통 (더러브렛 등)

    before_rank   VARCHAR(20),                     -- 변경 전 등급
    after_rank    VARCHAR(20),                     -- 변경 후 등급
    sp_date       DATE,                            -- 시행일 (대부분 NULL)

    raw           JSONB,
    fetched_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_horse_rank_changes UNIQUE (horse_no, st_date)
);

CREATE INDEX IF NOT EXISTS idx_horse_rank_changes_horse
    ON horse_rank_changes (horse_no, st_date DESC);
CREATE INDEX IF NOT EXISTS idx_horse_rank_changes_date
    ON horse_rank_changes (st_date DESC);

DROP TRIGGER IF EXISTS trg_horse_rank_changes_updated_at ON horse_rank_changes;
CREATE TRIGGER trg_horse_rank_changes_updated_at
    BEFORE UPDATE ON horse_rank_changes
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- scraper_jobs seed 는 통합 대시보드(crawler 스키마)에서 관리.

COMMIT;
