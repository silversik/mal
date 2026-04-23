-- mal.kr: horse_ratings 시계열화 — PK 를 (horse_no, snapshot_date) 복합키로 변경.
--
-- 배경
-- ----
-- 014_horse_ratings 는 API77 응답에 공시일자가 없어 horse_no 단일 PK 로 스냅샷-only 였다.
-- 1차 사이클 운영 검토에서 "rating4 의 주간 변화"가 분석 가치가 있다고 판단 (플랜 B1 의
-- "변화 추적이 분석 가치" 의도). 우리가 fetch 한 시점(`fetched_at::date`) 을 snapshot_date
-- 로 사용해 자체 시계열을 누적한다. (KRA 가 동일 horse 의 rating 을 갱신해도 같은 날
-- 다시 fetch 하면 update, 다음 날 fetch 하면 insert.)
--
-- 기존 데이터 보존
-- ---------------
-- 17,031 row 의 snapshot_date 는 fetched_at::date (= 2026-04-23) 으로 설정.
-- 다음 주 sync_horse_ratings (토 07:30) 부터 새 snapshot row 가 추가됨.
--
-- Depends on: 014_horse_ratings.sql

BEGIN;

ALTER TABLE horse_ratings DROP CONSTRAINT IF EXISTS horse_ratings_pkey;

ALTER TABLE horse_ratings ADD COLUMN IF NOT EXISTS snapshot_date DATE;
UPDATE horse_ratings SET snapshot_date = fetched_at::date WHERE snapshot_date IS NULL;
ALTER TABLE horse_ratings ALTER COLUMN snapshot_date SET NOT NULL;
ALTER TABLE horse_ratings ALTER COLUMN snapshot_date SET DEFAULT CURRENT_DATE;

ALTER TABLE horse_ratings ADD CONSTRAINT horse_ratings_pkey PRIMARY KEY (horse_no, snapshot_date);

-- "horse 의 최신 레이팅" 조회 (DISTINCT ON / ORDER BY DESC LIMIT 1) 가속용.
CREATE INDEX IF NOT EXISTS idx_horse_ratings_horse_date_desc
    ON horse_ratings (horse_no, snapshot_date DESC);

COMMIT;
