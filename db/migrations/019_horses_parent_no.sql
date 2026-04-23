-- mal.kr: 마필 부모 horse_no 컬럼 (혈통 트리 ID-기반 조회 전환)
-- Source: KRA API42_1/totalHorseInfo_1 응답에 이미 fhrNo(부)/mhrNo(모) 가 들어 있음.
--   기존 getPedigree 는 sire_name/dam_name 문자열 매칭으로 LATERAL JOIN — 동명이마/
--   미등록 조상 시 부정확. 부모 horse_no 컬럼을 채워 ID-기반 join 으로 전환한다.
--
-- 백필: horses.raw->>'fhrNo' / 'mhrNo' 에서 직접 추출. KRA 응답이 "-" / 0 / 빈문자
--   인 경우는 NULL 처리. 실제 horses 테이블에 그 horse_no 가 존재하지 않아도 OK
--   (조상이 DB 에 없을 수 있음 — 트리에서 stub 노드로 표시).
--
-- Depends on: 001_init.sql (horses 테이블).

BEGIN;

ALTER TABLE horses
    ADD COLUMN IF NOT EXISTS sire_no VARCHAR(20),
    ADD COLUMN IF NOT EXISTS dam_no  VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_horses_sire_no ON horses (sire_no) WHERE sire_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_horses_dam_no  ON horses (dam_no)  WHERE dam_no  IS NOT NULL;

-- 백필: raw 에서 추출. "-" / "0" / 빈문자 → NULL.
-- raw->>'fhrNo' 는 jsonb scalar 가 number 든 string 이든 text 로 정규화해서 돌려준다.
UPDATE horses
   SET sire_no = NULLIF(NULLIF(NULLIF(raw->>'fhrNo', ''), '-'), '0'),
       dam_no  = NULLIF(NULLIF(NULLIF(raw->>'mhrNo', ''), '-'), '0')
 WHERE raw IS NOT NULL
   AND (sire_no IS NULL OR dam_no IS NULL);

COMMIT;
