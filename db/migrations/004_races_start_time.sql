-- mal.kr: races 테이블에 발주 시각 컬럼 추가
-- KRA API187 HorseRaceInfo 의 rcTime 필드 (HH:MM 형식)

BEGIN;

ALTER TABLE races
  ADD COLUMN IF NOT EXISTS start_time VARCHAR(10);  -- 예: "10:05"

COMMIT;
