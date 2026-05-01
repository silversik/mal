-- 인앱 알림(in-app notification) 적재 테이블.
-- 즐겨찾기 한 마필의 다음 경기 출주 확정 시 알림 1건씩 INSERT.
-- (현 시점 채널은 인앱 only — 헤더 벨 아이콘 + /notifications 페이지)
--
-- Depends on:
--   001_init.sql           (set_updated_at trigger fn)
--   010_users_auth.sql     (users 테이블)

BEGIN;

CREATE TABLE IF NOT EXISTS notifications (
    id          BIGSERIAL    PRIMARY KEY,
    user_id     BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 카테고리 — 향후 'jockey_change', 'rating_up' 등 확장 여지.
    kind        TEXT         NOT NULL,                              -- 'horse_upcoming_race' …

    -- 멱등키 — 같은 (user, kind, horse, race) 조합으로 두 번 INSERT 되지 않도록.
    -- 잡이 매번 즐겨찾기 → 출주 확정 매칭하므로 중복 필터가 필수.
    dedup_key   TEXT         NOT NULL,

    title       TEXT         NOT NULL,
    body        TEXT,
    href        TEXT,                                                -- 클릭 시 이동할 내부 경로 (e.g. /races?date=…&venue=…&race=…)

    -- 읽음 표시. 헤더 벨 빨간 배지는 read_at IS NULL count.
    read_at     TIMESTAMPTZ,

    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedup
    ON notifications (user_id, kind, dedup_key);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications (user_id, read_at, created_at DESC);

COMMIT;
