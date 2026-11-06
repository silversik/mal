-- mal.kr: race_plans.race_date 를 raw->>'pgDate' 로 채운다.
--
-- 배경
-- ----
-- KRA API40 응답의 경주일 키는 pgDate(YYYYMMDD) 인데, 크롤러 매핑이 rc_date/rcDate/
-- raceDate 만 봐서 race_date 가 항상 NULL 로 저장됐다 (웹은 raw->>'pgDate' 로 우회).
-- 크롤러는 이제 pgDate 를 읽으므로 새로 수집되는 행은 채워지고, 이 마이그레이션은
-- 다시 수집되지 않는 과거 연도 행을 채운다.
--
-- race_date 는 unique 키(meet, year, race_name)에 포함되지 않아 충돌 없음.
-- 이미 값이 있는 행은 건드리지 않음 · 재실행해도 결과 동일 (idempotent).

UPDATE race_plans
   SET race_date = to_date(raw->>'pgDate', 'YYYYMMDD')
 WHERE race_date IS NULL
   AND raw->>'pgDate' ~ '^[0-9]{8}$';
