-- mal.kr 사용자 닉네임
-- Depends on: 010_users_auth.sql
--
-- 기존 `users.name` 은 OAuth provider 가 주는 원본 이름이라 로그인 시마다
-- 덮어씌워짐 (auth.ts signIn 콜백). 커뮤니티에서 사용자가 직접 정하는 표시용
-- 닉네임은 별도 컬럼으로 분리한다.
--
-- 닉네임은 NULL 가능 (미설정 시 name 으로 fallback).
-- 값이 있을 때는 전역 UNIQUE.

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS nickname TEXT;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_nickname_len_chk;
ALTER TABLE users
    ADD CONSTRAINT users_nickname_len_chk
    CHECK (nickname IS NULL OR char_length(nickname) BETWEEN 2 AND 20);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_nickname
    ON users (nickname)
    WHERE nickname IS NOT NULL;

COMMIT;
