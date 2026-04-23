-- mal.kr: 경주별·마필별 단·연 배당
-- Source: KRA OpenAPI API301/Dividend_rate_total (publicDataPk=15119558)
--
-- API 응답 분석 (2026-04-23):
--   row 당 (pool, combo) — 한 경주의 *모든 출주마* 단/연 배당이 row 단위로 들어옴.
--   pool 종류: WIN(단승), PLC(연승), QNL(복승), QPL(쌍승식), EXA(쌍승), TRI(삼복승), TLA(삼쌍승)
--   필드: rcDate, meet, rcNo, pool, chulNo, chulNo2, chulNo3, odds
--
-- 1차 사이클 범위: 단승(WIN) + 연승(PLC) — 출마표/결과 페이지의 horse-level 표시용.
-- 복식(QNL/QPL/EXA/TRI/TLA) 은 별도 테이블 후속 이터레이션.
--
-- 설계: (race_date, meet, race_no, horse_no) 1 row — race_results 와 horse_no 로 JOIN.
-- Depends on: 001_init.sql (set_updated_at trigger fn).

BEGIN;

CREATE TABLE IF NOT EXISTS race_dividends (
    id              BIGSERIAL    PRIMARY KEY,
    race_date       DATE         NOT NULL,
    meet            VARCHAR(20)  NOT NULL,           -- 서울/제주/부경
    race_no         INT          NOT NULL,
    horse_no        VARCHAR(20)  NOT NULL,           -- 마번 (chulNo) — race_results 와 JOIN 키

    win_rate        NUMERIC(8, 1),                   -- 단승 배당률 (배수)
    plc_rate        NUMERIC(8, 1),                   -- 연승 배당률 (배수)

    raw_win         JSONB,                           -- WIN row 원본
    raw_plc         JSONB,                           -- PLC row 원본
    fetched_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_race_dividends UNIQUE (race_date, meet, race_no, horse_no)
);

CREATE INDEX IF NOT EXISTS idx_race_dividends_date      ON race_dividends (race_date DESC);
CREATE INDEX IF NOT EXISTS idx_race_dividends_race      ON race_dividends (race_date, meet, race_no);

DROP TRIGGER IF EXISTS trg_race_dividends_updated_at ON race_dividends;
CREATE TRIGGER trg_race_dividends_updated_at
    BEFORE UPDATE ON race_dividends
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();


-- scraper_jobs seed 은 통합 대시보드(crawler 스키마)에서 관리 — mal_app 은 권한 없음.
-- JOB_CATALOG + `register-dashboard-jobs` CLI 가 idempotent 등록.

COMMIT;
