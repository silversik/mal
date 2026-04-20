-- kra_news.image_url 추가 — RSS의 <media:thumbnail> / <enclosure type='image/*'> /
-- summary 본문 첫 <img src=...> 등에서 추출한 대표 이미지 URL.
-- 이미지가 없는 항목은 NULL → 프론트에서 썸네일 영역을 아예 렌더하지 않음.

BEGIN;

ALTER TABLE kra_news
    ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMIT;
