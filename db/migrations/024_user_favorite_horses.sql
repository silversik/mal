-- 사용자별 즐겨찾기 마필.
-- 마필 상세 페이지의 ★ 버튼 토글 시 INSERT/DELETE.
-- 다음 경기 일정이 잡히면 인앱 알림(notifications) 으로 이어진다.
--
-- Depends on:
--   001_init.sql           (set_updated_at trigger fn)
--   010_users_auth.sql     (users 테이블)

BEGIN;

CREATE TABLE IF NOT EXISTS user_favorite_horses (
    user_id     BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    horse_no    VARCHAR(20)  NOT NULL,                              -- horses(horse_no) 와 동일 키. FK는 굳이 — 미수집 마필도 즐겨찾기 가능하게.
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, horse_no)
);

-- 알림 잡이 "이 마필을 즐겨찾기 한 user 들" 을 역조회 — horse_no 로 인덱스 필요.
CREATE INDEX IF NOT EXISTS idx_user_favorite_horses_horse
    ON user_favorite_horses (horse_no);

COMMIT;
