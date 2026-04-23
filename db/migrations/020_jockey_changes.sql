-- mal.kr: 기수 변경 이벤트 로그 (출주 후 기수 교체)
-- Source: KRA OpenAPI dataset 15057181 — "기수변경" (API10_1/jockeyChangeInfo_1)
--   출주표 발표 이후 기수가 교체된 경우의 이벤트. 일반적으로 부상/사정으로 발생.
--   응답 필드 (2026-04-23 실측):
--     rcDate, meet (한글), rcNo, chulNo, hrNo, hrName,
--     jkBef, jkBefName, jkAft, jkAftName,
--     befBudam, aftBudam, reason
--
-- Per (race_date, meet, race_no, chul_no) UNIQUE — 같은 출주마는 1건만.
-- Depends on: 001_init.sql (set_updated_at trigger fn).

BEGIN;

CREATE TABLE IF NOT EXISTS jockey_changes (
    id              BIGSERIAL    PRIMARY KEY,
    race_date       DATE         NOT NULL,
    meet            VARCHAR(20)  NOT NULL,           -- 서울/제주/부경
    race_no         INT          NOT NULL,
    chul_no         INT          NOT NULL,           -- 출주번호 (마번)
    horse_no        VARCHAR(20)  NOT NULL,
    horse_name      VARCHAR(100),

    jk_no_before    VARCHAR(20),
    jk_name_before  VARCHAR(50),
    jk_no_after     VARCHAR(20),
    jk_name_after   VARCHAR(50),

    weight_before   NUMERIC(4, 1),                   -- 부담중량 (변경 전)
    weight_after    NUMERIC(4, 1),                   -- 부담중량 (변경 후)

    reason          TEXT,
    raw             JSONB,
    fetched_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_jockey_changes UNIQUE (race_date, meet, race_no, chul_no)
);

CREATE INDEX IF NOT EXISTS idx_jockey_changes_date ON jockey_changes (race_date DESC);
CREATE INDEX IF NOT EXISTS idx_jockey_changes_race ON jockey_changes (race_date, meet, race_no);
CREATE INDEX IF NOT EXISTS idx_jockey_changes_horse ON jockey_changes (horse_no, race_date DESC);

DROP TRIGGER IF EXISTS trg_jockey_changes_updated_at ON jockey_changes;
CREATE TRIGGER trg_jockey_changes_updated_at
    BEFORE UPDATE ON jockey_changes
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- scraper_jobs seed 은 통합 대시보드(crawler 스키마)에서 관리 — mal_app 은 권한 없음.
-- JOB_CATALOG + `register-dashboard-jobs` CLI 가 idempotent 등록.

COMMIT;
