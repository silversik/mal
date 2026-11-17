-- mal.kr: race_entries.scratched_at — 출전취소(스크래치) 명시 표시 (추가 전용)
--
-- 배경
-- ----
-- 출전표(API26_2) upsert 는 행을 지우지 않는다. 출전표 공표 뒤 취소된 말은 다음 재수집에서
-- 빠질 뿐 race_entries 에 그대로 남아, 소비처(경마지 등)가 updated_at 이 배치보다 오래됐는지로
-- 추측해야 했다. 크롤러(sync_race_entries · sync_late_changes)가 재수집 응답에서 빠진 말에
-- scratched_at 을 찍고, 다시 나타나면 NULL 로 되돌린다.
--
-- 공식 출전취소 API(data.go.kr 15056779)는 별도 활용신청 승인 뒤 연동 예정 — 그때도 이 컬럼을 쓴다.
--
-- Depends on: race_entries (출전표)

BEGIN;

ALTER TABLE race_entries ADD COLUMN IF NOT EXISTS scratched_at TIMESTAMPTZ;

COMMENT ON COLUMN race_entries.scratched_at IS
    '출전표 재수집에서 빠진 시각 (NULL = 출전). 다시 나타나면 NULL 로 복귀';

COMMIT;
