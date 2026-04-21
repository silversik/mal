-- 011_move_scraper_to_crawler_schema.sql
--
-- 단일 DB 통합 + 공용 크롤러 대시보드 이관.
--
-- 배경:
--   - mal.scraper_jobs / mal.scraper_runs 는 mal 전용 스크래퍼 모니터링용으로 만들어졌다.
--   - 통합 서버로 이관되면서 betlive / ranked / shared(hotdeal·price) 의 크롤러 상태도 같은 대시보드에
--     집계해야 한다. 그래서 테이블을 `crawler` 스키마로 옮기고, `service` / `category` 컬럼을 추가한다.
--   - 기존 admin UI (web/src/app/admin/) 는 별도 `crawler/dashboard` 앱으로 분리되며, mal.kr web 에서는 제거.
--   - 이 마이그레이션은 "통합 서버" 컨텍스트에서 한 번만 실행. 로컬에서 이미 옮겨둔 DB 에서는
--     ALTER 구문이 no-op 또는 IF EXISTS 로 skip 된다.
--
-- Depends on:
--   - 008_scraper_monitoring.sql (원본 mal.scraper_* 테이블)
--   - /srv/stack/postgres/init.sql (crawler 스키마가 이미 존재)
--
-- 멱등성:
--   - ALTER TABLE ... SET SCHEMA 는 이미 옮겨졌으면 에러 → IF EXISTS 로 감싼 DO 블록 사용.

BEGIN;

-- 1. crawler 스키마 보장 (init.sql 에서 이미 만들었을 수 있음)
CREATE SCHEMA IF NOT EXISTS crawler;

-- 2. 테이블 이동 — 이미 crawler 로 옮겨져 있으면 스킵
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'mal' AND table_name = 'scraper_jobs'
    ) THEN
        ALTER TABLE mal.scraper_jobs SET SCHEMA crawler;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'mal' AND table_name = 'scraper_runs'
    ) THEN
        ALTER TABLE mal.scraper_runs SET SCHEMA crawler;
    END IF;
END $$;

-- 3. 확장 컬럼 — service / category
--    service  : 'betlive' | 'mal' | 'ranked' | 'shared' 등 (job_key prefix 와 매칭)
--    category : source 와 별개의 2차 그룹핑 (예: 'hotdeal', 'price', 'score', 'stores', 'kra_openapi')
ALTER TABLE crawler.scraper_jobs
    ADD COLUMN IF NOT EXISTS service  TEXT NOT NULL DEFAULT 'mal';

ALTER TABLE crawler.scraper_jobs
    ADD COLUMN IF NOT EXISTS category TEXT;

-- 4. 기존 mal 데이터 backfill: service 는 이미 DEFAULT 'mal', category 는 source 값 유지(가까움)
UPDATE crawler.scraper_jobs
   SET category = source
 WHERE category IS NULL;

-- 5. DEFAULT 제거 — 이후 등록되는 job 은 반드시 service 를 명시 (크롤러 client 가 세팅).
ALTER TABLE crawler.scraper_jobs ALTER COLUMN service DROP DEFAULT;

-- 6. 인덱스 (대시보드의 service·category 필터용)
CREATE INDEX IF NOT EXISTS idx_crawler_jobs_service
    ON crawler.scraper_jobs (service, category);

-- 7. 대시보드·크롤러 전용 role 에 권한 부여 — crawler_app 이 자기 스키마 소유자면 생략해도 OK.
--    init.sql 이 ALTER SCHEMA crawler OWNER TO crawler_app 로 세팅했다면 이 GRANT 는 no-op.
GRANT USAGE ON SCHEMA crawler TO crawler_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA crawler TO crawler_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA crawler TO crawler_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA crawler
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crawler_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA crawler
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO crawler_app;

COMMIT;
