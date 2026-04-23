-- mal.kr: 경주마 레이팅 (스냅샷)
-- Source: KRA OpenAPI dataset 15057323 (recommendDataYn=Y) — "경주마 레이팅 정보"
--   엔드포인트: B551015/API77/raceHorseRating
--
-- API 응답 분석 (2026-04-23):
--   row 단위가 (마필) — 한 마필당 1 row, rating1~rating4 컬럼.
--   응답에 *공시일자가 없음* — 시계열 비교 불가, 항상 "최신 스냅샷" 의미.
--   필드: hrNo, hrName, meet, rating1, rating2, rating3, rating4
--   rating1~4 의 정확한 의미는 KRA 문서 미공개 — 가설: 등급별/연령별 또는 시계열 인덱스.
--
-- 설계: horse_no PK 의 단순 스냅샷. UPSERT 로 매 sync 시 덮어씀.
-- Depends on: 001_init.sql (set_updated_at).
--
-- ⚠ 본 마이그레이션은 dev 환경에서 v1 스키마(시계열) 를 1차 폐기 후 재정의함.

BEGIN;

DROP TABLE IF EXISTS horse_ratings CASCADE;

CREATE TABLE horse_ratings (
    horse_no        VARCHAR(20)  PRIMARY KEY,           -- horses.horse_no 와 일치 (FK 미설정 — 미등록 마필 raw 보존)
    horse_name      VARCHAR(100),                       -- 마명 (조회 편의)
    meet            VARCHAR(20),                        -- 서울/제주/부산경남

    rating1         INT,                                -- 레이팅 1 (의미 미공개 — raw 참조)
    rating2         INT,
    rating3         INT,
    rating4         INT,

    raw             JSONB,                              -- 원본 응답 보존 — 매핑 보정용
    fetched_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_horse_ratings_meet ON horse_ratings (meet);

DROP TRIGGER IF EXISTS trg_horse_ratings_updated_at ON horse_ratings;
CREATE TRIGGER trg_horse_ratings_updated_at
    BEFORE UPDATE ON horse_ratings
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();


-- scraper_jobs seed
INSERT INTO scraper_jobs (job_key, source, description, expected_interval_sec) VALUES
    ('sync_horse_ratings', 'kra_openapi', '경주마 레이팅 (API77/raceHorseRating)', 604800)
ON CONFLICT (job_key) DO NOTHING;

COMMIT;
