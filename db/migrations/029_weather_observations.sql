-- mal.kr: 경주 발주시각 기상 관측 — weather_observations (HR)
-- Source: 기상청_지상(종관, ASOS) 시간자료 (data.go.kr 1360000/AsosHourlyInfoService)
--
-- 경마 경주는 분 단위 발주시각이 있어 일자료(avg/min/max)로는 같은 날 오전 경주와
-- 오후 경주를 구분 못 한다. 시간자료로 받아 races.start_time 기준 정확한 시각의
-- 환경값을 사용한다.
--
-- 경마장 → ASOS 관측소 (근접 매핑):
--   meet="서울" (과천) → stnId=119 (수원)  -- 서울108 보다 과천에 더 가까움
--   meet="제주" (애월) → stnId=184 (제주)
--   meet="부경" (강서) → stnId=159 (부산)
-- 매핑 상수는 crawler/src/clients/kma_asos.py 와 web/src/lib/horses.ts 양쪽에 정의.
--
-- 한 row = (관측소 × 시각) 1시간 데이터. 한 발주시각 = 정시 시간자료 한 행.
-- 발주 14:50 의 경우 14:00 행과 매칭(date_trunc('hour')).

BEGIN;

CREATE TABLE IF NOT EXISTS weather_observations (
    station_id  SMALLINT     NOT NULL,                  -- 119(수원) / 184(제주) / 159(부산)
    obs_time    TIMESTAMPTZ  NOT NULL,                  -- KMA 가 KST 응답 → tz 명시 저장
    ta          NUMERIC(4,1),                           -- 시점 기온 (℃)
    rn          NUMERIC(5,1),                           -- 1시간 강수량 (mm)
    ws          NUMERIC(4,1),                           -- 풍속 (m/s)
    wd          SMALLINT,                               -- 풍향 (degree)
    hm          NUMERIC(4,1),                           -- 상대습도 (%)
    raw         JSONB,                                  -- 응답 원본
    fetched_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (station_id, obs_time)
);

CREATE INDEX IF NOT EXISTS idx_weather_obs_time ON weather_observations (obs_time DESC);

DROP TRIGGER IF EXISTS trg_weather_obs_updated_at ON weather_observations;
CREATE TRIGGER trg_weather_obs_updated_at
    BEFORE UPDATE ON weather_observations
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- scraper_jobs seed 는 통합 대시보드(crawler 스키마)에서 관리 — mal_app 권한 없음.

COMMIT;
