-- mal.kr: 복식 (조합) 확정배당 — race_dividends (단·연승) 자매 테이블.
-- Source: KRA OpenAPI API301/Dividend_rate_total (publicDataPk=15119558) 응답의
--         WIN/PLC 외 pool — QNL/QPL/EXA/TRI/TLA.
--
-- pool 의미:
--   QNL (복승)   — 2 마 unordered  (1·2 위, 순서 무관)
--   QPL (쌍승식) — 2 마 unordered  (KRA 정의상 QNL 와 별도 발매)
--   EXA (쌍승)   — 2 마 ordered    (1·2 위, 순서 일치)
--   TRI (삼복승) — 3 마 unordered  (1·2·3 위, 순서 무관)
--   TLA (삼쌍승) — 3 마 ordered    (1·2·3 위, 순서 일치)
--
-- 설계 원칙:
--   * combo_key 는 canonical 표현. 정렬 vs 원순서는 pool 별 구분.
--     - unordered (QNL/QPL/TRI): horse_no 오름차순 정렬 후 '-' join
--     - ordered   (EXA/TLA)    : 원순서 (chulNo, chulNo2[, chulNo3]) '-' join
--     이렇게 하면 (race, pool, combo_key) 가 자연스러운 유니크.
--   * horse_no_1/2/3 은 *원순서* (KRA 응답 그대로) 보존 — 표시·디버깅용.
--   * 단일 pool row = 단일 odds. WIN/PLC 처럼 row 합치기 불필요.
--
-- Depends on: 001_init.sql (set_updated_at), 013_race_dividends.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS race_combo_dividends (
    id              BIGSERIAL    PRIMARY KEY,
    race_date       DATE         NOT NULL,
    meet            VARCHAR(20)  NOT NULL,           -- 서울/제주/부경
    race_no         INT          NOT NULL,
    pool            VARCHAR(8)   NOT NULL,           -- QNL/QPL/EXA/TRI/TLA
    combo_key       TEXT         NOT NULL,           -- canonical key — pool 별 규칙

    horse_no_1      VARCHAR(20)  NOT NULL,           -- KRA 응답 chulNo (원순서)
    horse_no_2      VARCHAR(20)  NOT NULL,           -- chulNo2
    horse_no_3      VARCHAR(20),                     -- chulNo3 (TRI/TLA only)

    odds            NUMERIC(10, 1),                  -- 배당률 (배수)
    raw             JSONB,                           -- API row 원본
    fetched_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_race_combo_dividends UNIQUE (race_date, meet, race_no, pool, combo_key)
);

CREATE INDEX IF NOT EXISTS idx_race_combo_dividends_race
    ON race_combo_dividends (race_date, meet, race_no);
CREATE INDEX IF NOT EXISTS idx_race_combo_dividends_date
    ON race_combo_dividends (race_date DESC);

DROP TRIGGER IF EXISTS trg_race_combo_dividends_updated_at ON race_combo_dividends;
CREATE TRIGGER trg_race_combo_dividends_updated_at
    BEFORE UPDATE ON race_combo_dividends
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- scraper_jobs seed 은 통합 대시보드(crawler 스키마)에서 관리 — mal_app 권한 없음.
-- JOB_CATALOG ("mal.sync_race_dividends") 가 단·연·복식 모두 묶어서 트래킹.

COMMIT;
