-- mal.kr 커뮤니티 자유게시판
-- Depends on: 001_init.sql (set_updated_at trigger fn), 010_users_auth.sql (users)
--
-- 작성은 로그인 사용자만 가능 (user_id NOT NULL).
-- 사용자 탈퇴 시 글도 함께 정리하기 위해 ON DELETE CASCADE.

BEGIN;

CREATE TABLE IF NOT EXISTS community_posts (
    id          BIGSERIAL    PRIMARY KEY,
    user_id     BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT         NOT NULL,
    content     TEXT         NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT community_posts_title_len_chk
        CHECK (char_length(title) BETWEEN 1 AND 120),
    CONSTRAINT community_posts_content_len_chk
        CHECK (char_length(content) BETWEEN 1 AND 10000)
);

CREATE INDEX IF NOT EXISTS idx_community_posts_created
    ON community_posts (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_community_posts_user
    ON community_posts (user_id);

DROP TRIGGER IF EXISTS trg_community_posts_updated_at ON community_posts;
CREATE TRIGGER trg_community_posts_updated_at
    BEFORE UPDATE ON community_posts
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
