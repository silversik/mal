-- mal.kr: 경주 통과순위·구간기록 — race_result_corners
-- Source: KRA OpenAPI API4_2/raceResult_2 (publicDataPk=15089493)
--
-- race_results 가 (horse, race) 1 row 인 것과 동일 골격에 코너 통과순위 추가.
-- 별도 테이블로 분리한 이유:
--   1) race_results 는 racedetailresult 응답 수정이 무거움 (스키마 안정성).
--   2) API4_2 활용신청이 별도 — 일부 환경 미적재 시 graceful degradation.
--   3) 페이스 맵 (B-1) 만 사용 — race_results JOIN 비용 절감.
--
-- Phase F (데이터 보강) 의 일부.
-- Depends on: 001_init.sql, 002_jockeys_races.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS race_result_corners (
    id          BIGSERIAL    PRIMARY KEY,
    race_date   DATE         NOT NULL,
    meet        VARCHAR(20)  NOT NULL,
    race_no     INT          NOT NULL,
    horse_no    VARCHAR(20)  NOT NULL,

    -- 코너 통과순위 (1=가장 앞)
    ord_1c      INT,
    ord_2c      INT,
    ord_3c      INT,
    ord_4c      INT,
    -- 펄롱 통과순위
    ord_s1f     INT,           -- 출발 1펄롱
    ord_g3f     INT,           -- 결승 3펄롱
    ord_g1f     INT,           -- 결승 1펄롱

    raw         JSONB,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_race_result_corners UNIQUE (race_date, meet, race_no, horse_no)
);

CREATE INDEX IF NOT EXISTS idx_race_result_corners_race
    ON race_result_corners (race_date, meet, race_no);
CREATE INDEX IF NOT EXISTS idx_race_result_corners_horse
    ON race_result_corners (horse_no);

DROP TRIGGER IF EXISTS trg_race_result_corners_updated_at ON race_result_corners;
CREATE TRIGGER trg_race_result_corners_updated_at
    BEFORE UPDATE ON race_result_corners
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- scraper_jobs seed 는 통합 대시보드(crawler 스키마)에서 관리 — mal_app 권한 없음.

COMMIT;
