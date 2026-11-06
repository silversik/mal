-- mal.kr: 기존 horse_ratings.snapshot_date 를 KST 날짜로 보정.
--
-- 배경
-- ----
-- 033 이전 snapshot_date 는 DB CURRENT_DATE(세션 timezone)로 찍혔다. DB 가 UTC 면
-- 토 07:30 KST 수집분(= 금 22:30 UTC)이 금요일로 들어가 있다.
--
-- 보정 기준
-- ---------
-- snapshot_date = (fetched_at AT TIME ZONE 'Asia/Seoul')::date
--   fetched_at 은 insert 시 now(), 같은 날 재수집 시 now() 로 갱신되므로 "마지막 수집 시각".
--   DB 가 이미 KST 였다면 값이 그대로라 사실상 no-op. 재실행해도 결과 동일 (idempotent).
--
-- 충돌 처리
-- ---------
-- 보정 후 같은 (horse_no, 날짜) 로 모이는 row 가 생기면 (예: 같은 KST 날 수동 재수집),
-- fetched_at 이 가장 늦은 1건만 남긴다 — 033 이후 잡이 같은 KST 날 재실행을 update 로
-- 처리하는 것과 같은 규칙.
--
-- PK 컬럼을 일괄 UPDATE 하면 처리 순서에 따라 중간 충돌이 날 수 있어 (Postgres 는 비지연
-- unique 를 row 단위로 검사) PK 를 잠시 내렸다가 다시 건다 (016 과 같은 방식).
--
-- Depends on: 033_horse_ratings_snapshot_kst.sql

BEGIN;

CREATE TEMP TABLE _hr_kst_fix ON COMMIT DROP AS
SELECT
    horse_no,
    snapshot_date                                   AS old_date,
    (fetched_at AT TIME ZONE 'Asia/Seoul')::date    AS new_date,
    row_number() OVER (
        PARTITION BY horse_no, (fetched_at AT TIME ZONE 'Asia/Seoul')::date
        ORDER BY fetched_at DESC, snapshot_date DESC
    )                                               AS rn
FROM horse_ratings;

-- 같은 KST 날로 겹치는 row 중 최신 1건만 유지
DELETE FROM horse_ratings h
 USING _hr_kst_fix f
 WHERE h.horse_no = f.horse_no
   AND h.snapshot_date = f.old_date
   AND f.rn > 1;

ALTER TABLE horse_ratings DROP CONSTRAINT IF EXISTS horse_ratings_pkey;

UPDATE horse_ratings h
   SET snapshot_date = f.new_date
  FROM _hr_kst_fix f
 WHERE h.horse_no = f.horse_no
   AND h.snapshot_date = f.old_date
   AND f.rn = 1
   AND f.new_date <> f.old_date;

ALTER TABLE horse_ratings ADD CONSTRAINT horse_ratings_pkey PRIMARY KEY (horse_no, snapshot_date);

COMMIT;
