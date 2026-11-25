-- 039_normalize_meet_labels.sql
--
-- 경마장(meet) 라벨을 정규 라벨 하나로 모은다: '부산경남' → '부경', '양천' → '영천'.
--
-- 배경: 크롤러가 KRA 응답의 한글 meet 을 그대로 저장해, 2026-08-16 부터 같은 부경 경주가
-- 테이블마다 '부경'/'부산경남' 두 라벨로 쌓였다 (영천 경주결과는 '양천'). unique 키에 meet 이
-- 들어 있어 웹 /races 가 8/16 이후 부경 결과를 찾지 못한다. 수집 쪽은 PR #104
-- (crawler/src/meets.py normalize_meet) 가 고쳤고, 이 파일은 이미 저장된 행을 옮긴다.
--
-- ⚠ 적용 조건
--   1. PR #104 가 먼저 배포돼 있어야 한다. 옛 크롤러가 돌고 있으면 별칭 행이 다시 쌓인다.
--   2. 경주 수집이 없는 시간에 적용한다 (월 12:00 이후 ~ 금 10:00 이전). 테이블마다
--      트리거를 잠깐 끄면서 쓰기 잠금을 잡는다 — 수 초.
--   3. race_results 는 KRA 원천 데이터다 (CLAUDE.md "절대 어기지 말 것" 2). 이 파일은
--      meet 라벨 컬럼만 바꾸고 rank·record_time·weight·이름·raw 는 건드리지 않는다
--      (raw->>'meet' 에 KRA 원문이 남는다). 그래도 수동 SQL 금지 규칙의 예외이므로
--      소유자 승인 뒤에만 머지한다.
--
-- 같은 키가 두 라벨로 다 있을 때 (unique 충돌)
--   races           정규 라벨 행의 빈 컬럼을 별칭 행 값으로 채운 뒤 별칭 행 삭제.
--                   (당일 HTML 크롤링이 만든 '부경' 행 + 결과·출전표에서 온 '부산경남' 행)
--   race_results    원천 값이 같으면 별칭 행 삭제. 값이 다르면 (KRA 정정이 한쪽에만 반영)
--                   어느 쪽이 최신인지 알 수 없으므로 **둘 다 그대로 두고** WARNING 으로
--                   건수를 남긴다 — 사람이 보고 정한다.
--   그 외 키 테이블  updated_at 이 더 새로운 행을 남긴다 (같으면 정규 라벨 행).
--
-- 옮기지 않는 것
--   race_plans      웹(race_plans.ts · /races/schedule)이 '부산경남' 기준이고 크롤러도 원문
--                   그대로 저장한다 — 크롤러·웹과 한 PR 로 따로 옮긴다.
--   racing_form_*   추가 전용(트리거로 UPDATE 금지), 발행 시점에 이미 정규 라벨로 저장.
--
-- 멱등: 별칭 행이 없으면 아무것도 바꾸지 않는다. 적용 결과는 NOTICE 로 테이블별 건수 출력.

BEGIN;

CREATE TEMP TABLE _meet_alias (
    alias text PRIMARY KEY,
    canon text NOT NULL
) ON COMMIT DROP;

INSERT INTO _meet_alias (alias, canon) VALUES
    ('부산경남', '부경'),
    ('양천',     '영천');


-- ---------------------------------------------------------------- 1. races
-- 정규 라벨 행에 별칭 행의 메타를 합친 뒤 별칭 행을 지운다. (races 를 참조하는 FK 없음)

UPDATE races c
   SET race_name       = COALESCE(c.race_name,       x.race_name),
       distance        = COALESCE(c.distance,        x.distance),
       grade           = COALESCE(c.grade,           x.grade),
       track_type      = COALESCE(c.track_type,      x.track_type),
       track_condition = COALESCE(c.track_condition, x.track_condition),
       entry_count     = COALESCE(c.entry_count,     x.entry_count),
       start_time      = COALESCE(c.start_time,      x.start_time),
       raw             = COALESCE(c.raw,             x.raw),
       created_at      = LEAST(c.created_at, x.created_at)
  FROM races x
  JOIN _meet_alias a ON a.alias = x.meet
 WHERE c.meet = a.canon
   AND c.race_date = x.race_date
   AND c.race_no = x.race_no;

DO $$
DECLARE
    n_merged bigint;
    n_moved  bigint;
BEGIN
    DELETE FROM races x
     USING _meet_alias a, races c
     WHERE x.meet = a.alias
       AND c.meet = a.canon
       AND c.race_date = x.race_date
       AND c.race_no = x.race_no;
    GET DIAGNOSTICS n_merged = ROW_COUNT;

    UPDATE races r SET meet = a.canon FROM _meet_alias a WHERE r.meet = a.alias;
    GET DIAGNOSTICS n_moved = ROW_COUNT;

    RAISE NOTICE '[039] races: 두 라벨 병합 % 행, 라벨 이전 % 행', n_merged, n_moved;
END $$;


-- ---------------------------------------------------------------- 2. race_results
-- KRA 원천 데이터 — 라벨만 바꾼다. 두 라벨로 겹친 행은 원천 값이 같을 때만 별칭 행을 지운다.

DO $$
DECLARE
    n_same   bigint;
    n_moved  bigint;
    n_left   bigint;
BEGIN
    DELETE FROM race_results x
     USING _meet_alias a, race_results c
     WHERE x.meet = a.alias
       AND c.meet = a.canon
       AND c.horse_no = x.horse_no
       AND c.race_date = x.race_date
       AND c.race_no = x.race_no
       AND (x.track_condition, x.rank, x.record_time, x.weight,
            x.jockey_name, x.trainer_name, x.jk_no, x.tr_no)
           IS NOT DISTINCT FROM
           (c.track_condition, c.rank, c.record_time, c.weight,
            c.jockey_name, c.trainer_name, c.jk_no, c.tr_no);
    GET DIAGNOSTICS n_same = ROW_COUNT;

    UPDATE race_results x
       SET meet = a.canon
      FROM _meet_alias a
     WHERE x.meet = a.alias
       AND NOT EXISTS (
           SELECT 1 FROM race_results c
            WHERE c.meet = a.canon
              AND c.horse_no = x.horse_no
              AND c.race_date = x.race_date
              AND c.race_no = x.race_no
       );
    GET DIAGNOSTICS n_moved = ROW_COUNT;

    SELECT COUNT(*) INTO n_left
      FROM race_results x JOIN _meet_alias a ON a.alias = x.meet;

    RAISE NOTICE '[039] race_results: 라벨 이전 % 행, 값이 같은 중복 삭제 % 행', n_moved, n_same;
    IF n_left > 0 THEN
        RAISE WARNING '[039] race_results: 두 라벨의 값이 달라 그대로 둔 별칭 행 % 건 — '
                      '어느 쪽이 KRA 최신값인지 확인 후 수동 정리 필요', n_left;
    END IF;
END $$;


-- ---------------------------------------------------------------- 3. 키에 meet 이 있는 나머지
-- updated_at 트리거가 라벨 이전만으로 "방금 수집됨" 으로 보이게 하지 않도록 잠깐 끈다
-- (healthcheck 의 신선도 판정이 MAX(updated_at) 을 본다). 소유자가 아니라 끌 수 없으면
-- 그대로 진행한다 — 그 테이블의 updated_at 만 적용 시각으로 바뀐다.

DO $$
DECLARE
    t         record;
    join_keys text;
    n_older   bigint;
    n_dup     bigint;
    n_moved   bigint;
    trig_off  boolean;
BEGIN
    FOR t IN
        SELECT * FROM (VALUES
            ('race_entries',         ARRAY['race_date', 'race_no', 'horse_no']),
            ('race_dividends',       ARRAY['race_date', 'race_no', 'horse_no']),
            ('race_combo_dividends', ARRAY['race_date', 'race_no', 'pool', 'combo_key']),
            ('race_pool_sales',      ARRAY['race_date', 'race_no', 'pool']),
            ('jockey_changes',       ARRAY['race_date', 'race_no', 'chul_no']),
            ('race_corners',         ARRAY['race_date', 'race_no'])
        ) AS v(tbl, keys)
    LOOP
        IF to_regclass(t.tbl) IS NULL THEN
            RAISE NOTICE '[039] %: 테이블 없음 — 건너뜀', t.tbl;
            CONTINUE;
        END IF;

        SELECT string_agg(format('c.%1$I = x.%1$I', k), ' AND ')
          INTO join_keys
          FROM unnest(t.keys) AS k;

        trig_off := true;
        BEGIN
            EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', t.tbl);
        EXCEPTION WHEN insufficient_privilege THEN
            trig_off := false;
            RAISE NOTICE '[039] %: 트리거를 끌 권한 없음 — updated_at 이 적용 시각으로 바뀜', t.tbl;
        END;

        -- 별칭 행이 더 새로우면 정규 라벨 행을 지우고 별칭 행을 남긴다 (아래에서 라벨 이전).
        EXECUTE format(
            'DELETE FROM %1$I c USING _meet_alias a, %1$I x '
            'WHERE c.meet = a.canon AND x.meet = a.alias AND %2$s '
            'AND x.updated_at > c.updated_at',
            t.tbl, join_keys);
        GET DIAGNOSTICS n_older = ROW_COUNT;

        -- 그 외 겹침은 정규 라벨 행을 남긴다.
        EXECUTE format(
            'DELETE FROM %1$I x USING _meet_alias a, %1$I c '
            'WHERE x.meet = a.alias AND c.meet = a.canon AND %2$s',
            t.tbl, join_keys);
        GET DIAGNOSTICS n_dup = ROW_COUNT;

        EXECUTE format(
            'UPDATE %I x SET meet = a.canon FROM _meet_alias a WHERE x.meet = a.alias',
            t.tbl);
        GET DIAGNOSTICS n_moved = ROW_COUNT;

        IF trig_off THEN
            EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', t.tbl);
        END IF;

        RAISE NOTICE '[039] %: 라벨 이전 % 행, 중복 삭제 % 행 (별칭 쪽 % · 정규 쪽 %)',
            t.tbl, n_moved, n_older + n_dup, n_dup, n_older;
    END LOOP;
END $$;


-- ---------------------------------------------------------------- 4. meet 이 키가 아닌 테이블
-- 소속 경마장 컬럼 등 — 충돌 없이 라벨만 바꾼다.

DO $$
DECLARE
    tbl      text;
    n_moved  bigint;
    trig_off boolean;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'jockeys', 'trainers', 'owners', 'horse_ratings', 'horse_rank_changes', 'kra_videos'
    ]
    LOOP
        IF to_regclass(tbl) IS NULL THEN
            RAISE NOTICE '[039] %: 테이블 없음 — 건너뜀', tbl;
            CONTINUE;
        END IF;

        trig_off := true;
        BEGIN
            EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', tbl);
        EXCEPTION WHEN insufficient_privilege THEN
            trig_off := false;
            RAISE NOTICE '[039] %: 트리거를 끌 권한 없음 — updated_at 이 적용 시각으로 바뀜', tbl;
        END;

        EXECUTE format(
            'UPDATE %I x SET meet = a.canon FROM _meet_alias a WHERE x.meet = a.alias', tbl);
        GET DIAGNOSTICS n_moved = ROW_COUNT;

        IF trig_off THEN
            EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', tbl);
        END IF;

        RAISE NOTICE '[039] %: 라벨 이전 % 행', tbl, n_moved;
    END LOOP;
END $$;


-- ---------------------------------------------------------------- 5. 라벨이 문자열에 들어간 곳

-- 경주 댓글: entity_id = 'YYYY-MM-DD_<meet>_<race_no>' (web/src/lib/comments.ts RACE_ID_RE).
-- 웹이 이 id 로 races 를 찾으므로 라벨을 같이 옮겨야 댓글이 경주에 붙어 있는다.
DO $$
DECLARE
    n_moved bigint;
BEGIN
    UPDATE entity_comments ec
       SET entity_id = regexp_replace(
               ec.entity_id,
               '^(\d{4}-\d{2}-\d{2})_' || a.alias || '_(\d+)$',
               '\1_' || a.canon || '_\2')
      FROM _meet_alias a
     WHERE ec.entity_type = 'race'
       AND ec.entity_id ~ ('^\d{4}-\d{2}-\d{2}_' || a.alias || '_\d+$');
    GET DIAGNOSTICS n_moved = ROW_COUNT;
    RAISE NOTICE '[039] entity_comments(race): id 라벨 이전 % 행', n_moved;
END $$;

-- 즐겨찾기 출주 알림: dedup_key = 'horse_no|race_date|<meet>|race_no', href 에 venue=<meet>.
-- dedup_key 를 옮기지 않으면 출전표 라벨이 바뀐 뒤 같은 경주 알림이 한 번 더 만들어진다.
-- 정규 라벨 알림이 이미 있으면 (같은 사용자·경주) 키는 그대로 두고 링크·본문만 고친다.
DO $$
DECLARE
    n_key  bigint;
    n_link bigint;
BEGIN
    UPDATE notifications n
       SET dedup_key = replace(n.dedup_key, '|' || a.alias || '|', '|' || a.canon || '|')
      FROM _meet_alias a
     WHERE n.kind = 'horse_upcoming_race'
       AND n.dedup_key LIKE '%|' || a.alias || '|%'
       AND NOT EXISTS (
           SELECT 1 FROM notifications m
            WHERE m.user_id = n.user_id
              AND m.kind = n.kind
              AND m.dedup_key = replace(n.dedup_key, '|' || a.alias || '|', '|' || a.canon || '|')
       );
    GET DIAGNOSTICS n_key = ROW_COUNT;

    UPDATE notifications n
       SET href = replace(n.href, 'venue=' || a.alias || '&', 'venue=' || a.canon || '&'),
           body = replace(n.body, ' · ' || a.alias || ' · ', ' · ' || a.canon || ' · ')
      FROM _meet_alias a
     WHERE n.kind = 'horse_upcoming_race'
       AND (n.href LIKE '%venue=' || a.alias || '&%'
            OR n.body LIKE '% · ' || a.alias || ' · %');
    GET DIAGNOSTICS n_link = ROW_COUNT;

    RAISE NOTICE '[039] notifications: 중복 방지 키 이전 % 행, 링크·본문 수정 % 행', n_key, n_link;
END $$;


-- ---------------------------------------------------------------- 6. 남은 별칭 라벨 점검
-- race_results 의 값이 다른 중복(2번의 WARNING) 말고는 0 이어야 한다.

DO $$
DECLARE
    tbl    text;
    n_left bigint;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'races', 'race_entries', 'race_dividends', 'race_combo_dividends', 'race_pool_sales',
        'jockey_changes', 'race_corners', 'jockeys', 'trainers', 'owners', 'horse_ratings',
        'horse_rank_changes', 'kra_videos'
    ]
    LOOP
        IF to_regclass(tbl) IS NULL THEN
            CONTINUE;
        END IF;
        EXECUTE format(
            'SELECT COUNT(*) FROM %I x JOIN _meet_alias a ON a.alias = x.meet', tbl)
           INTO n_left;
        IF n_left > 0 THEN
            RAISE EXCEPTION '[039] %: 별칭 라벨이 % 행 남음 — 롤백', tbl, n_left;
        END IF;
    END LOOP;
END $$;

COMMIT;
