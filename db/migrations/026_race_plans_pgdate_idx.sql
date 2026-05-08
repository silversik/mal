-- NO-OP: 이 마이그레이션의 원래 의도는 race_plans 의 raw->>'pgDate' 함수형
-- 인덱스를 만드는 것이었으나 to_date() 가 STABLE 이라 PostgreSQL 이 인덱스
-- 표현식으로 받지 않음 ("functions in index expression must be marked
-- IMMUTABLE"). 그 결과 빌드 #49/#50 실패.
--
-- race_plans 는 수십 row 규모라 sequential scan + sort 로도 1ms 미만 — 인덱스
-- 필요 없음. unstable_cache (10분 TTL) 가 이미 cache miss 비용도 감춤. 따라서
-- 인덱스 추가 자체를 포기.
--
-- 마이그레이션 자체는 _migrations_applied 에 기록되도록 NO-OP 으로 유지
-- (파일 삭제 대신 빈 트랜잭션) — 향후 같은 번호 재사용 방지.

BEGIN;

SELECT 1;

COMMIT;
