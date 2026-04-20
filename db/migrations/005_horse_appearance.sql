-- mal.kr schema extension: 마필 외형 정보 (모색 + 특징)
-- Depends on: 001_init.sql
--
-- Source: KRA OpenAPI (API42_1) raw payload
--   color            → coat_color        (모색)
--   char1..char4     → characteristics   (특징; '-' 은 제외)

BEGIN;

ALTER TABLE horses
    ADD COLUMN IF NOT EXISTS coat_color      VARCHAR(20),
    ADD COLUMN IF NOT EXISTS characteristics TEXT[];

CREATE INDEX IF NOT EXISTS idx_horses_coat_color ON horses (coat_color);

-- Backfill from existing raw payload (10/450 have raw; rest will be backfilled
-- via `collector backfill-horse-raw`).
UPDATE horses
   SET coat_color = NULLIF(raw->>'color', '-')
 WHERE raw IS NOT NULL
   AND jsonb_typeof(raw) = 'object'
   AND coat_color IS NULL;

UPDATE horses
   SET characteristics = ARRAY(
           SELECT c FROM unnest(ARRAY[
               NULLIF(raw->>'char1', '-'),
               NULLIF(raw->>'char2', '-'),
               NULLIF(raw->>'char3', '-'),
               NULLIF(raw->>'char4', '-')
           ]) AS c
           WHERE c IS NOT NULL AND c <> ''
       )
 WHERE raw IS NOT NULL
   AND jsonb_typeof(raw) = 'object'
   AND characteristics IS NULL;

COMMIT;
