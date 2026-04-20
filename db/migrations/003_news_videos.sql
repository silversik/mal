-- mal.kr schema extension: 공식 뉴스 (RSS) + 공식 영상 (YouTube)
-- Depends on: 001_init.sql (set_updated_at trigger fn)

BEGIN;

-- ============================================================================
-- 1. kra_news : 한국마사회 공식 공지/뉴스 (RSS 수집)
-- 저작권: 제목 + 짧은 요약만 보관, 본문 크롤링 금지. 클릭 시 원문 outlink.
-- ============================================================================
CREATE TABLE IF NOT EXISTS kra_news (
    id            BIGSERIAL    PRIMARY KEY,
    guid          TEXT         NOT NULL UNIQUE,           -- RSS <guid> (없으면 link)
    title         TEXT         NOT NULL,
    summary       TEXT,                                   -- description (HTML 제거, 500자 컷)
    link          TEXT         NOT NULL,                  -- KRA 원문 outlink
    category      TEXT,                                   -- RSS <category> (선택)
    published_at  TIMESTAMPTZ  NOT NULL,                  -- pubDate
    source        TEXT         NOT NULL DEFAULT 'KRA',
    raw           JSONB,                                  -- 원본 entry dict
    fetched_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kra_news_published ON kra_news (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_kra_news_category  ON kra_news (category);

DROP TRIGGER IF EXISTS trg_kra_news_updated_at ON kra_news;
CREATE TRIGGER trg_kra_news_updated_at
    BEFORE UPDATE ON kra_news
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 2. kra_videos : KRBC 한국마사회 경마방송 공식 유튜브 (YouTube Data API v3)
-- 임베드 형태로 제공 — 본문은 description 200자만 보관.
-- ============================================================================
CREATE TABLE IF NOT EXISTS kra_videos (
    id             BIGSERIAL    PRIMARY KEY,
    video_id       TEXT         NOT NULL UNIQUE,          -- YouTube videoId (11자)
    channel_id     TEXT         NOT NULL,                 -- 채널 ID
    channel_title  TEXT,                                  -- "KRBC 한국마사회 경마방송"
    title          TEXT         NOT NULL,
    description    TEXT,                                  -- 200자 컷
    thumbnail_url  TEXT         NOT NULL,                 -- maxres > standard > high > medium 폴백
    duration_sec   INT,                                   -- ISO8601 PT##M##S → 초
    view_count     BIGINT,
    published_at   TIMESTAMPTZ  NOT NULL,
    raw            JSONB,
    fetched_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kra_videos_published ON kra_videos (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_kra_videos_channel   ON kra_videos (channel_id);

DROP TRIGGER IF EXISTS trg_kra_videos_updated_at ON kra_videos;
CREATE TRIGGER trg_kra_videos_updated_at
    BEFORE UPDATE ON kra_videos
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 3. sync_meta : 동기화 메타데이터 (ETag/Last-Modified, YouTube pageToken 등)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_meta (
    source         TEXT         PRIMARY KEY,              -- 'kra_rss', 'youtube_krbc'
    last_run_at    TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    etag           TEXT,
    last_modified  TEXT,
    page_token     TEXT,
    last_error     TEXT,
    raw            JSONB,
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_sync_meta_updated_at ON sync_meta;
CREATE TRIGGER trg_sync_meta_updated_at
    BEFORE UPDATE ON sync_meta
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
