-- mal.kr: 경주별·풀별 매출액
-- Source: KRA OpenAPI dataset 15119558 / API179_1/salesAndDividendRate_1
--   응답 1행 = (rcDate, meet, rcNo, pool) 의 매출액 + 인기순위 odds 텍스트.
--   pool ∈ {단식, 연식, 쌍식, 복식, 복연, 삼복, 삼쌍} 7종.
--
-- meet 은 KRA 가 숫자(1/2/3) 로 반환 → 다른 테이블과 일치하도록 한글로 저장.
-- amount 는 원 단위 (수십만~수억 원), BIGINT.
-- Per (race_date, meet, race_no, pool) UNIQUE.
--
-- Depends on: 001_init.sql (set_updated_at trigger fn).

BEGIN;

CREATE TABLE IF NOT EXISTS race_pool_sales (
    id            BIGSERIAL    PRIMARY KEY,
    race_date     DATE         NOT NULL,
    meet          VARCHAR(20)  NOT NULL,           -- 서울/제주/부경 (한글로 정규화)
    race_no       INT          NOT NULL,
    pool          VARCHAR(8)   NOT NULL,           -- 단식/연식/쌍식/복식/복연/삼복/삼쌍

    amount        BIGINT       NOT NULL,           -- 매출액 (원)
    odds_summary  TEXT,                            -- "②-1.1  ⑧-1.1  ⑪-3" 형태 텍스트

    raw           JSONB,
    fetched_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_race_pool_sales UNIQUE (race_date, meet, race_no, pool)
);

CREATE INDEX IF NOT EXISTS idx_race_pool_sales_race
    ON race_pool_sales (race_date, meet, race_no);
CREATE INDEX IF NOT EXISTS idx_race_pool_sales_date
    ON race_pool_sales (race_date DESC);

DROP TRIGGER IF EXISTS trg_race_pool_sales_updated_at ON race_pool_sales;
CREATE TRIGGER trg_race_pool_sales_updated_at
    BEFORE UPDATE ON race_pool_sales
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- scraper_jobs seed 는 통합 대시보드(crawler 스키마)에서 관리 — mal_app 은 권한 없음.
-- JOB_CATALOG + `register-dashboard-jobs` CLI 가 idempotent 등록.

COMMIT;
