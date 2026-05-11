-- mal.kr: 경주일 기상 관측 — weather_observations
-- Source: 기상청_지상(종관, ASOS) 일자료 조회서비스 (data.go.kr 1360000/AsosDalyInfoService)
--
-- 경마장은 ASOS 관측소와 완전히 일치하지 않아 근접 관측소로 매핑한다:
--   meet="서울" (과천) → stnId=119 (수원)  -- 서울108 보다 과천에 더 가까움
--   meet="제주" (애월) → stnId=184 (제주)
--   meet="부경" (강서) → stnId=159 (부산)
-- 매핑 상수는 crawler 및 web 양쪽에서 정의 (값 변경 시 양쪽 동기 필요).
--
-- 일자료(dateCd=DAY) 한 row 가 한 관측소 × 한 날짜의 일통계. raw 에 응답
-- 원본 보존해 추후 컬럼 추가 시 backfill 없이 SELECT 로 채울 수 있게 함.

BEGIN;

CREATE TABLE IF NOT EXISTS weather_observations (
    station_id  SMALLINT     NOT NULL,                  -- 119(수원) / 184(제주) / 159(부산)
    obs_date    DATE         NOT NULL,
    avg_ta      NUMERIC(4,1),                           -- 평균기온 (℃)
    min_ta      NUMERIC(4,1),                           -- 최저기온
    max_ta      NUMERIC(4,1),                           -- 최고기온
    sum_rn      NUMERIC(5,1),                           -- 일강수량 (mm)
    avg_ws      NUMERIC(4,1),                           -- 평균풍속 (m/s)
    avg_rhm     NUMERIC(4,1),                           -- 평균상대습도 (%)
    iscs        TEXT,                                   -- 일기현상 원문 (예: "비후눈,눈날림")
    raw         JSONB,                                  -- 응답 원본
    fetched_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (station_id, obs_date)
);

CREATE INDEX IF NOT EXISTS idx_weather_obs_date ON weather_observations (obs_date DESC);

DROP TRIGGER IF EXISTS trg_weather_obs_updated_at ON weather_observations;
CREATE TRIGGER trg_weather_obs_updated_at
    BEFORE UPDATE ON weather_observations
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- scraper_jobs seed 는 통합 대시보드(crawler 스키마)에서 관리 — mal_app 권한 없음.

COMMIT;
