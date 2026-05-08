-- race_plans 의 raw->>'pgDate' 기반 정렬·필터 (홈 페이지 "다가오는 대상경주") 가속.
-- 기존 idx_race_plans_date 는 race_date 컬럼만 커버하지만 데이터 적재 단계에서
-- race_date 가 NULL/TBD 인 row 가 많아 실제 쿼리는 raw->>'pgDate' 를 to_date 로
-- 변환해 정렬한다 (web/src/lib/race_plans.ts: getUpcomingStakesFromPlans).
--
-- 함수형 인덱스라 plan 단계에서 to_date(raw->>'pgDate','YYYYMMDD') 표현식과
-- 매칭되어 사용된다. raw->>'pgDate' 가 8자리 숫자가 아닌 row 는 인덱스에서
-- 제외해 인덱스 사이즈를 작게 유지.
--
-- Depends on:
--   009_race_plans_entries.sql

BEGIN;

CREATE INDEX IF NOT EXISTS idx_race_plans_pgdate
  ON race_plans ((to_date(raw->>'pgDate', 'YYYYMMDD')))
  WHERE raw->>'pgDate' ~ '^[0-9]{8}$';

COMMIT;
