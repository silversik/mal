-- mal.kr: 불특정 다수 공용 채팅 — 경마 중계용 경량 채팅
-- 인증 없음. room은 '전체' | '서울' | '제주' | '부경'.

BEGIN;

CREATE TABLE IF NOT EXISTS chat_messages (
    id         BIGSERIAL    PRIMARY KEY,
    room       TEXT         NOT NULL,
    username   TEXT         NOT NULL,
    message    TEXT         NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chat_messages_room_chk
        CHECK (room IN ('전체','서울','제주','부경')),
    CONSTRAINT chat_messages_message_len_chk
        CHECK (char_length(message) BETWEEN 1 AND 500),
    CONSTRAINT chat_messages_username_len_chk
        CHECK (char_length(username) BETWEEN 1 AND 20)
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id
    ON chat_messages (room, id DESC);

COMMIT;
