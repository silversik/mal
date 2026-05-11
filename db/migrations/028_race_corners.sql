-- mal.kr: 경주 구간별 성적 — race_corners (race-level)
-- Source: KRA OpenAPI API6_1/raceDetailSectionRecord_1 (publicDataPk=15057847)
--
-- 027 의 race_result_corners 는 (horse_no 별 row) 가설로 만들었으나, 실제 KRA
-- 응답은 **경주 단위 1 row** (horse_no 미포함, 1등마의 통과순위만). 따라서
-- 027 테이블 폐기하고 race-level 신규 테이블 도입.
--
-- 컬럼 그룹:
--   passrank_* — 통과순위 (출발 S1F → 1C/2C/3C/4C → 결승 G2F/G1F)
--                서울/제주는 "1C~4C" 명칭, 부경은 "G8F/G6F/G4F/G3F" — KRA 가
--                같은 컬럼에 통합해 응답 (passrankG8f_1c 등 prefix 가 시사).
--   time_*f    — 1F~12F 구간기록 (TEXT, KRA 응답 그대로)
--   dist_*f    — 1F~10F 펄롱 누적 통과거리 (m, INT)
--   passtime_*f — 펄롱 통과 누적시간 (TEXT)
--
-- 페이스 맵 (B-1) 의존. 활용신청 별도 (KRA publicDataPk=15057847).
--
-- Depends on: 001_init.sql (set_updated_at).

BEGIN;

-- 027 의 horse-level 가설 테이블 폐기 (잘못된 가정).
DROP TABLE IF EXISTS race_result_corners CASCADE;

CREATE TABLE IF NOT EXISTS race_corners (
    id            BIGSERIAL    PRIMARY KEY,
    race_date     DATE         NOT NULL,
    meet          VARCHAR(20)  NOT NULL,
    race_no       INT          NOT NULL,
    rc_dist       INT,                            -- 경주 거리 (참고)

    -- 통과순위 — KRA 표기 텍스트. 모든 마필의 그 시점 순위를 한 row 에 압축.
    -- 예: "(^1,3,9)-7,2,6,(5,8),4"
    --   (...) = 동시 통과 그룹
    --   ,     = 출전번호 구분 (그룹 내)
    --   -     = 마신 차이 (그룹 사이 짧은 간격)
    --   =     = 큰 간격 (그룹 사이 긴 간격)
    --   ^     = 선두 마크
    passrank_s1f      TEXT,
    passrank_g8f_1c   TEXT,    -- G8F(부경) ↔ 1C(서울/제주)
    passrank_g6f_2c   TEXT,    -- G6F(부경) ↔ 2C(서울/제주)
    passrank_g4f_3c   TEXT,    -- G4F(부경) ↔ 3C(서울/제주)
    passrank_g3f_4c   TEXT,    -- G3F(부경) ↔ 4C(서울/제주)
    passrank_g2f      TEXT,
    passrank_g1f      TEXT,

    -- 펄롱별 구간기록 (1F~12F) — KRA 응답 그대로 텍스트 (예: "0:12.4")
    time_1f   TEXT, time_2f  TEXT, time_3f  TEXT, time_4f  TEXT,
    time_5f   TEXT, time_6f  TEXT, time_7f  TEXT, time_8f  TEXT,
    time_9f   TEXT, time_10f TEXT, time_11f TEXT, time_12f TEXT,

    -- 펄롱별 통과거리 (1F~10F, m)
    dist_1f  INT, dist_2f INT, dist_3f INT, dist_4f INT, dist_5f INT,
    dist_6f  INT, dist_7f INT, dist_8f INT, dist_9f INT, dist_10f INT,

    -- 펄롱별 통과시간 (1F~10F)
    passtime_1f   TEXT, passtime_2f  TEXT, passtime_3f  TEXT, passtime_4f  TEXT,
    passtime_5f   TEXT, passtime_6f  TEXT, passtime_7f  TEXT, passtime_8f  TEXT,
    passtime_9f   TEXT, passtime_10f TEXT,

    raw           JSONB,
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_race_corners UNIQUE (race_date, meet, race_no)
);

CREATE INDEX IF NOT EXISTS idx_race_corners_date ON race_corners (race_date DESC);
CREATE INDEX IF NOT EXISTS idx_race_corners_race ON race_corners (race_date, meet, race_no);

DROP TRIGGER IF EXISTS trg_race_corners_updated_at ON race_corners;
CREATE TRIGGER trg_race_corners_updated_at
    BEFORE UPDATE ON race_corners
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- scraper_jobs seed 는 통합 대시보드(crawler 스키마)에서 관리 — mal_app 권한 없음.

COMMIT;
