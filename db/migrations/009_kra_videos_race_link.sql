-- kra_videos 제목 파싱 결과를 컬럼으로 보관 → races 와 결정적 조인.
--
-- KRBC 제목 포맷: "(서울) 2026.02.28 1경주" / "(제주) 2026.01.24 4경주" / "(부경) ..."
-- 포맷이 맞지 않는 영상(하이라이트·특집 등)은 세 컬럼 모두 NULL.
--
-- 백필: 이미 적재된 행들도 동일 정규식으로 UPDATE.

BEGIN;

ALTER TABLE kra_videos
    ADD COLUMN IF NOT EXISTS race_date DATE,
    ADD COLUMN IF NOT EXISTS meet      TEXT,
    ADD COLUMN IF NOT EXISTS race_no   INT;

CREATE INDEX IF NOT EXISTS idx_kra_videos_race
    ON kra_videos (race_date, meet, race_no)
    WHERE race_date IS NOT NULL;

-- 기존 행 백필 ─ Postgres regexp_match 로 "(meet) YYYY.MM.DD N경주" 추출.
WITH parsed AS (
    SELECT
        id,
        regexp_match(
            title,
            '\(([^)]+)\)\s*(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})\s*(\d+)\s*경주'
        ) AS m
    FROM kra_videos
    WHERE race_date IS NULL
)
UPDATE kra_videos v
   SET meet      = p.m[1],
       race_date = make_date(p.m[2]::int, p.m[3]::int, p.m[4]::int),
       race_no   = p.m[5]::int
  FROM parsed p
 WHERE v.id = p.id
   AND p.m IS NOT NULL;

COMMIT;
