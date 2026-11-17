-- 037_race_results_jk_tr_no_backfill.sql
--
-- race_results.jk_no (002) / tr_no (015) 컬럼은 있었지만 크롤러가 채우지 않아 전부 NULL 이었다.
-- 크롤러(api_item_to_race_result_fields)가 이제 raw jkNo / trNo 를 매핑하므로,
-- 기존 행은 이미 저장된 raw JSON 에서 파생값만 채운다.
--
-- KRA 원천 값(rank·record_time·weight·이름·raw)은 건드리지 않는다 — NULL 인 파생 컬럼만 채움.
-- 멱등: 이미 채워진 행은 WHERE 에서 제외.

BEGIN;

UPDATE race_results
   SET jk_no = COALESCE(jk_no, NULLIF(btrim(raw->>'jkNo'), '')),
       tr_no = COALESCE(tr_no, NULLIF(btrim(raw->>'trNo'), ''))
 WHERE (jk_no IS NULL AND NULLIF(btrim(raw->>'jkNo'), '') IS NOT NULL)
    OR (tr_no IS NULL AND NULLIF(btrim(raw->>'trNo'), '') IS NOT NULL);

COMMIT;
