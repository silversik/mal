-- mal.kr 사용자/OAuth 계정 스키마
-- Depends on: 001_init.sql (set_updated_at trigger fn)
--
-- Auth 전략:
--   - Auth.js v5 + JWT 세션 (별도 sessions 테이블 불필요)
--   - 최초 로그인 시 users + user_accounts upsert (signIn 콜백에서)
--   - 한 user 가 여러 provider 계정을 연결 가능 (카카오 + 구글 + 애플…)
--
-- Tables:
--   users          — 서비스 사용자 프로필
--   user_accounts  — (provider, provider_account_id) → user_id 매핑

BEGIN;

-- ============================================================================
-- 1. users : 사용자 프로필
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id           BIGSERIAL    PRIMARY KEY,
    email        TEXT,                                   -- provider 가 주는 경우에만 (애플은 첫 로그인 후 숨길 수 있음)
    name         TEXT,                                   -- 닉네임/표시명
    image        TEXT,                                   -- 프로필 이미지 URL
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 이메일은 선택값이지만, 있으면 중복 방지 (partial unique).
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email
    ON users (email)
    WHERE email IS NOT NULL;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 2. user_accounts : OAuth provider 연결
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_accounts (
    user_id              BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider             TEXT         NOT NULL,         -- 'kakao' | 'google' | 'apple' …
    provider_account_id  TEXT         NOT NULL,         -- provider 측 sub / id
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    PRIMARY KEY (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_user
    ON user_accounts (user_id);

COMMIT;
