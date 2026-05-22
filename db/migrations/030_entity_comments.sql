-- mal.kr 엔티티별 댓글
-- Depends on: 001_init.sql (set_updated_at), 010_users_auth.sql (users)
--
-- entity_type: 'horse' | 'jockey' | 'trainer' | 'owner' | 'race'
-- entity_id: horse_no / jk_no / tr_no / ow_no / 'YYYYMMDD_meet_raceno'
-- entity_name: 표시명 스냅샷 (홈 최신 댓글 JOIN 없이 표시용)

BEGIN;

CREATE TABLE IF NOT EXISTS entity_comments (
    id           BIGSERIAL    PRIMARY KEY,
    entity_type  VARCHAR(20)  NOT NULL CHECK (entity_type IN ('horse','jockey','trainer','owner','race')),
    entity_id    VARCHAR(50)  NOT NULL,
    entity_name  VARCHAR(100) NOT NULL,
    user_id      BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content      TEXT         NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT entity_comments_content_len_chk
        CHECK (char_length(content) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_entity_comments_entity
    ON entity_comments (entity_type, entity_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_entity_comments_recent
    ON entity_comments (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_entity_comments_user
    ON entity_comments (user_id);

DROP TRIGGER IF EXISTS trg_entity_comments_updated_at ON entity_comments;
CREATE TRIGGER trg_entity_comments_updated_at
    BEFORE UPDATE ON entity_comments
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
