-- mal.kr 문의 게시판
-- Depends on: 001_init.sql (set_updated_at), 010_users_auth.sql (users)
--
-- status: 'pending'(접수) | 'in_progress'(처리중) | 'resolved'(완료)
-- user_id: NULL 허용 (비로그인 게스트 문의)

BEGIN;

CREATE TABLE IF NOT EXISTS contact_posts (
    id           BIGSERIAL    PRIMARY KEY,
    title        VARCHAR(100) NOT NULL,
    content      TEXT         NOT NULL,
    author_name  VARCHAR(30)  NOT NULL,
    user_id      BIGINT       REFERENCES users(id) ON DELETE SET NULL,
    status       VARCHAR(20)  NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'in_progress', 'resolved')),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT contact_posts_title_len_chk
        CHECK (char_length(title) BETWEEN 1 AND 100),
    CONSTRAINT contact_posts_content_len_chk
        CHECK (char_length(content) BETWEEN 1 AND 2000),
    CONSTRAINT contact_posts_author_len_chk
        CHECK (char_length(author_name) BETWEEN 1 AND 30)
);

CREATE INDEX IF NOT EXISTS idx_contact_posts_created
    ON contact_posts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_posts_user
    ON contact_posts (user_id);

CREATE TRIGGER trg_contact_posts_updated_at
    BEFORE UPDATE ON contact_posts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
