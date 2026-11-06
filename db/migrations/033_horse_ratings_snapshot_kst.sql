-- mal.kr: horse_ratings.snapshot_date 기본값을 KST 날짜로 변경.
--
-- 배경
-- ----
-- 016 에서 기본값을 CURRENT_DATE 로 두었는데, CURRENT_DATE 는 DB 세션 timezone 을 따른다.
-- DB 가 UTC 면 토요일 07:30 KST 실행(= 금요일 22:30 UTC)이 금요일로 찍힌다.
-- 크롤러(sync_horse_ratings)는 이제 KST 날짜를 명시로 넣고, 이 기본값은 다른 적재 경로용 안전망.
--
-- 기존 row 는 건드리지 않는다 (PK 컬럼 변경은 충돌 위험 → 필요하면 별도 마이그레이션).
--
-- Depends on: 016_horse_ratings_timeseries.sql

BEGIN;

ALTER TABLE horse_ratings
    ALTER COLUMN snapshot_date SET DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::date);

COMMIT;
