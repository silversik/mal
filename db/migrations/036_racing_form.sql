-- mal.kr: 경마지(racing form) — 전날 18:00 고정 발행본·예상·정산·과거 시험·공지 (추가 전용)
--
-- 배경
-- ----
-- 경마지는 경주일 D 의 (경주일, 경마장) 한 호를 D-1 18:00 에 발행하고 그 순간 동결한다.
-- 공개된 기준(레이팅·최근 성적·거리 적성·기수)이 각자 ◎○△ 를 고르고, 예상을 낸 기준 3개
-- 이상이 고른 말을 '주목마'로 싣는다. 적중 기록은 첫 호부터 전부 공개한다.
--
-- race_entries·race_results 는 upsert 로 덮어써 이력이 없으므로, 발행 시점의 입력·결과를
-- 재현하려면 발행본 JSON(payload)과 정산 결과를 따로 저장해야 한다.
--
-- 설계·운영: docs/feature/racing-form.md · 데이터 계약: docs/spec/racing-form-contract.md
--
-- 불변 원칙 (트리거로 보호)
-- -------------------------
-- * rule_sets·editions·picks·backtests·notices 는 추가만 가능 (UPDATE·DELETE 거부).
-- * race_outcomes 는 잠정 정산을 갱신할 수 있지만, 확정(is_final) 뒤에는 바꿀 수 없고
--   삭제는 항상 거부.
-- * 여섯 테이블 모두 TRUNCATE 거부 — 세션 GUC mal.racing_form_allow_truncate='on' 일 때만
--   허용 (e2e conftest 가 같은 트랜잭션에서 SET LOCAL).
-- * 트리거는 ENABLE ALWAYS — session_replication_role=replica 로도 우회되지 않는다.
-- * 정정·철회·미발행·쉼은 racing_form_notices 에 추가로만 기록한다.
--
-- 한계: CHECK 는 잡이 넣은 시각(published_at 등)만 본다. DB 시계(created_at)와의 차이,
-- payload 해시, 트리거 상태는 `racing-form-verify` CLI 와 healthcheck 가 점검한다.
-- 함수는 스키마를 붙이지 않는다 → prod(mal_app, search_path=mal,public)에서는 mal 스키마에
-- 생겨 `pg_dump -n mal` 백업에 포함된다.
--
-- sha256() 은 PostgreSQL 11 이상 (prod 16).

BEGIN;

-- ============================================================================
-- 1. 기준 정의 (버전별 1행)
-- ============================================================================
CREATE TABLE IF NOT EXISTS racing_form_rule_sets (
    rules_version      TEXT PRIMARY KEY,
    definition         JSONB NOT NULL,
    definition_sha256  TEXT NOT NULL,
    registered_at      TIMESTAMPTZ NOT NULL,              -- 잡 시계 (출시 경계 launchAt)
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- DB 시계
    CONSTRAINT ck_rf_rule_sets_sha CHECK (definition_sha256 ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE racing_form_rule_sets IS
    '경마지 기준 정의 버전 (추가 전용). definition_sha256 은 Python 정렬 JSON 해시 — SQL 로 재계산하지 않음';

-- ============================================================================
-- 2. 발행본 — (경주일, 경마장) 한 호
-- ============================================================================
CREATE TABLE IF NOT EXISTS racing_form_editions (
    id                BIGSERIAL PRIMARY KEY,
    race_date         DATE NOT NULL,
    meet              VARCHAR(20) NOT NULL,
    issue_no          INTEGER NOT NULL,
    rules_version     TEXT NOT NULL REFERENCES racing_form_rule_sets (rules_version),
    schema_version    INTEGER NOT NULL,
    history_before    DATE NOT NULL,          -- H: 과거 성적은 race_date < H
    results_through   DATE,                   -- 반영된 마지막 경주일 (< H)
    entries_batch_at  TIMESTAMPTZ,            -- 출전표 최신 배치 시각
    freeze_at         TIMESTAMPTZ NOT NULL,   -- D-1 18:00 KST
    deadline_at       TIMESTAMPTZ NOT NULL,   -- min(D 08:00, 첫 발주 - 60분)
    published_at      TIMESTAMPTZ NOT NULL,   -- 잡 시계 (실제 발행 시각)
    race_count        INTEGER NOT NULL,
    runner_count      INTEGER NOT NULL,
    summary           JSONB NOT NULL,         -- = payload -> 'summary' (허브·sitemap 용)
    payload           JSONB NOT NULL,
    payload_sha256    TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_rf_editions_day_meet UNIQUE (race_date, meet),
    CONSTRAINT uq_rf_editions_issue UNIQUE (meet, issue_no),
    CONSTRAINT ck_rf_issue_no CHECK (issue_no >= 1),
    CONSTRAINT ck_rf_schema_version CHECK (schema_version >= 1),
    CONSTRAINT ck_rf_counts CHECK (race_count >= 0 AND runner_count >= 0),
    CONSTRAINT ck_rf_history CHECK (history_before = race_date - 1),
    CONSTRAINT ck_rf_results_through CHECK (results_through IS NULL OR results_through < history_before),
    CONSTRAINT ck_rf_window CHECK (
        freeze_at = ((race_date - 1) + TIME '18:00') AT TIME ZONE 'Asia/Seoul'
        AND deadline_at <= (race_date + TIME '08:00') AT TIME ZONE 'Asia/Seoul'
        AND deadline_at > freeze_at
        AND published_at >= freeze_at
        AND published_at < deadline_at),
    -- 객체가 아니면(배열 ["summary"] 등) ? 는 참인데 -> 가 NULL 이라 CHECK 가 통과해 버린다
    CONSTRAINT ck_rf_summary CHECK (
        jsonb_typeof(payload) = 'object' AND payload ? 'summary' AND summary = payload -> 'summary'),
    CONSTRAINT ck_rf_sha CHECK (
        payload_sha256 = encode(sha256(convert_to(payload::text, 'UTF8')), 'hex'))
);

COMMENT ON TABLE racing_form_editions IS
    '경마지 발행본 (추가 전용). 한 (race_date, meet) 에 한 벌, 철회 후 재발행 불가';

-- ============================================================================
-- 3. 기준별 예상 (◎○△ = mark 1·2·3) + 주목마(rule_key=consensus, mark 1·2)
-- ============================================================================
CREATE TABLE IF NOT EXISTS racing_form_picks (
    id            BIGSERIAL PRIMARY KEY,
    edition_id    BIGINT NOT NULL REFERENCES racing_form_editions (id),
    race_date     DATE NOT NULL,
    meet          VARCHAR(20) NOT NULL,
    race_no       INTEGER NOT NULL,
    rule_key      TEXT NOT NULL,
    rule_version  TEXT NOT NULL,
    mark          SMALLINT NOT NULL,
    horse_no      VARCHAR(20) NOT NULL,
    chul_no       INTEGER,
    horse_name    VARCHAR(100),
    votes         SMALLINT,             -- consensus 만: 그 말을 고른 기준 수
    reason        TEXT,                 -- 동결된 근거 문장
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_rf_picks_mark UNIQUE (edition_id, race_no, rule_key, mark),
    CONSTRAINT uq_rf_picks_horse UNIQUE (edition_id, race_no, rule_key, horse_no),
    CONSTRAINT ck_rf_picks_race_no CHECK (race_no BETWEEN 1 AND 30),
    CONSTRAINT ck_rf_picks_rule_key CHECK (
        rule_key IN ('rating', 'form', 'course', 'jockey', 'trainer', 'consensus')),
    CONSTRAINT ck_rf_picks_mark CHECK (mark BETWEEN 1 AND 3),
    CONSTRAINT ck_rf_picks_consensus CHECK (
        (rule_key = 'consensus') = (votes IS NOT NULL)
        AND (rule_key <> 'consensus' OR mark <= 2))
);

CREATE INDEX IF NOT EXISTS idx_rf_picks_rule
    ON racing_form_picks (rule_key, rule_version, mark, race_date);
CREATE INDEX IF NOT EXISTS idx_rf_picks_race
    ON racing_form_picks (race_date, meet, race_no);

COMMENT ON TABLE racing_form_picks IS
    '경마지 기준별 예상 (추가 전용). 발행본 payload 와 같은 트랜잭션에 기록';

-- ============================================================================
-- 4. 경주별 정산 (잠정 → D+1 13:00 확정). 행이 없으면 대기
-- ============================================================================
CREATE TABLE IF NOT EXISTS racing_form_race_outcomes (
    edition_id        BIGINT NOT NULL REFERENCES racing_form_editions (id),
    race_no           INTEGER NOT NULL,
    race_date         DATE NOT NULL,
    status            TEXT NOT NULL,                       -- official | race_void
    starters          INTEGER NOT NULL,                    -- 결과 행 수 (출주 두수)
    finish            JSONB NOT NULL,                      -- [{horse_no, chul_no, rank, time_tenths}]
    winners           TEXT[] NOT NULL DEFAULT '{}',        -- 1착 horse_no (동착 포함)
    placed            TEXT[] NOT NULL DEFAULT '{}',        -- 3착 이내 horse_no
    non_starters      TEXT[] NOT NULL DEFAULT '{}',        -- 발행 명단에 있었는데 결과 행 없음 → 무효
    extra_starters    TEXT[] NOT NULL DEFAULT '{}',        -- 결과에만 있는 말 (stale 품질 지표)
    favorites         TEXT[] NOT NULL DEFAULT '{}',        -- 확정 단승 배당 최저 (동률 모두)
    pop_ranks         JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {horse_no: 인기 순위}
    results_digest    TEXT NOT NULL,
    first_settled_at  TIMESTAMPTZ NOT NULL,
    settled_at        TIMESTAMPTZ NOT NULL,
    is_final          BOOLEAN NOT NULL DEFAULT FALSE,
    finalized_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (edition_id, race_no),
    CONSTRAINT ck_rf_outcome_status CHECK (status IN ('official', 'race_void')),
    CONSTRAINT ck_rf_outcome_starters CHECK (starters >= 0),
    CONSTRAINT ck_rf_outcome_final CHECK (NOT is_final OR finalized_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_rf_outcomes_date
    ON racing_form_race_outcomes (race_date DESC);

COMMENT ON TABLE racing_form_race_outcomes IS
    '경마지 경주별 정산. 확정(is_final) 뒤 UPDATE 거부, DELETE 항상 거부';

-- ============================================================================
-- 5. 출시 전 과거 데이터 시험 (holdout 은 정의 해시당 1회)
-- ============================================================================
CREATE TABLE IF NOT EXISTS racing_form_backtests (
    id                 BIGSERIAL PRIMARY KEY,
    candidate_version  TEXT NOT NULL,
    definition_sha256  TEXT NOT NULL,
    label              TEXT NOT NULL,          -- dev | holdout
    period_from        DATE NOT NULL,
    period_to          DATE NOT NULL,
    meets              TEXT[] NOT NULL,
    report             JSONB NOT NULL,
    report_sha256      TEXT NOT NULL,
    code_rev           TEXT,
    is_public          BOOLEAN NOT NULL DEFAULT FALSE,
    computed_at        TIMESTAMPTZ NOT NULL,   -- 잡 시계
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_rf_bt_label CHECK (label IN ('dev', 'holdout')),
    CONSTRAINT ck_rf_bt_period CHECK (period_from <= period_to),
    CONSTRAINT ck_rf_bt_def_sha CHECK (definition_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_rf_bt_sha CHECK (
        report_sha256 = encode(sha256(convert_to(report::text, 'UTF8')), 'hex'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rf_backtests_holdout
    ON racing_form_backtests (definition_sha256) WHERE label = 'holdout';

COMMENT ON TABLE racing_form_backtests IS
    '경마지 출시 전 과거 데이터 시험 보고서 (추가 전용). holdout 은 정의 해시당 1회';

-- ============================================================================
-- 6. 공지 — 미발행·정정·철회·결과 변경·쉼, 그리고 내부용 발행 실패 기록(dedup)
-- ============================================================================
CREATE TABLE IF NOT EXISTS racing_form_notices (
    id           BIGSERIAL PRIMARY KEY,
    race_date    DATE NOT NULL,          -- paused 는 시작일
    meet         VARCHAR(20),            -- NULL = 모든 경마장
    edition_id   BIGINT REFERENCES racing_form_editions (id),
    kind         TEXT NOT NULL,
    public_text  TEXT NOT NULL,          -- 템플릿으로만 생성 (예외 원문 노출 금지)
    detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
    source       TEXT NOT NULL,          -- job | operator
    noticed_at   TIMESTAMPTZ NOT NULL,   -- 잡 시계
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dedup_key    TEXT NOT NULL,
    CONSTRAINT uq_rf_notices_dedup UNIQUE (dedup_key),
    CONSTRAINT ck_rf_notice_kind CHECK (
        kind IN ('missed', 'erratum', 'withdrawn', 'result_changed', 'paused', 'publish_failed')),
    CONSTRAINT ck_rf_notice_source CHECK (source IN ('job', 'operator')),
    CONSTRAINT ck_rf_notice_edition CHECK (
        (kind = 'missed' AND edition_id IS NULL)
        OR (kind IN ('erratum', 'withdrawn', 'result_changed') AND edition_id IS NOT NULL)
        OR kind IN ('paused', 'publish_failed')),
    -- until 이 없거나 JSON null·배열이면 ->> 가 NULL → NULL 은 CHECK 를 통과하므로 COALESCE 로 거부
    CONSTRAINT ck_rf_notice_paused CHECK (
        kind <> 'paused' OR COALESCE((detail ->> 'until') ~ '^\d{4}-\d{2}-\d{2}$', false))
);

CREATE INDEX IF NOT EXISTS idx_rf_notices_day_meet
    ON racing_form_notices (race_date, meet);

COMMENT ON TABLE racing_form_notices IS
    '경마지 공지 (추가 전용). kind=publish_failed 는 내부 기록 — 웹에 노출하지 않음';

-- ============================================================================
-- 7. 보호 트리거 (12개, 모두 ENABLE ALWAYS)
-- ============================================================================
CREATE OR REPLACE FUNCTION racing_form_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '경마지 기록은 수정·삭제할 수 없습니다 (% %)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION racing_form_outcome_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '경마지 정산은 삭제할 수 없습니다 (edition %, race %)',
            OLD.edition_id, OLD.race_no;
    END IF;
    IF OLD.is_final THEN
        RAISE EXCEPTION '확정된 경마지 정산은 바꿀 수 없습니다 (edition %, race %)',
            OLD.edition_id, OLD.race_no;
    END IF;
    IF NEW.edition_id <> OLD.edition_id OR NEW.race_no <> OLD.race_no
       OR NEW.race_date <> OLD.race_date OR NEW.first_settled_at <> OLD.first_settled_at THEN
        RAISE EXCEPTION '경마지 정산의 키·최초 정산 시각은 바꿀 수 없습니다 (edition %, race %)',
            OLD.edition_id, OLD.race_no;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION racing_form_no_truncate()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('mal.racing_form_allow_truncate', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION '경마지 기록 테이블은 TRUNCATE 할 수 없습니다 (%)', TG_TABLE_NAME;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 행 트리거 — 추가 전용 5개
DROP TRIGGER IF EXISTS trg_rf_rule_sets_guard ON racing_form_rule_sets;
CREATE TRIGGER trg_rf_rule_sets_guard
    BEFORE UPDATE OR DELETE ON racing_form_rule_sets
    FOR EACH ROW EXECUTE FUNCTION racing_form_append_only();

DROP TRIGGER IF EXISTS trg_rf_editions_guard ON racing_form_editions;
CREATE TRIGGER trg_rf_editions_guard
    BEFORE UPDATE OR DELETE ON racing_form_editions
    FOR EACH ROW EXECUTE FUNCTION racing_form_append_only();

DROP TRIGGER IF EXISTS trg_rf_picks_guard ON racing_form_picks;
CREATE TRIGGER trg_rf_picks_guard
    BEFORE UPDATE OR DELETE ON racing_form_picks
    FOR EACH ROW EXECUTE FUNCTION racing_form_append_only();

DROP TRIGGER IF EXISTS trg_rf_backtests_guard ON racing_form_backtests;
CREATE TRIGGER trg_rf_backtests_guard
    BEFORE UPDATE OR DELETE ON racing_form_backtests
    FOR EACH ROW EXECUTE FUNCTION racing_form_append_only();

DROP TRIGGER IF EXISTS trg_rf_notices_guard ON racing_form_notices;
CREATE TRIGGER trg_rf_notices_guard
    BEFORE UPDATE OR DELETE ON racing_form_notices
    FOR EACH ROW EXECUTE FUNCTION racing_form_append_only();

-- 행 트리거 — 정산 1개
DROP TRIGGER IF EXISTS trg_rf_outcomes_guard ON racing_form_race_outcomes;
CREATE TRIGGER trg_rf_outcomes_guard
    BEFORE UPDATE OR DELETE ON racing_form_race_outcomes
    FOR EACH ROW EXECUTE FUNCTION racing_form_outcome_guard();

-- 문장 트리거 — TRUNCATE 거부 6개
DROP TRIGGER IF EXISTS trg_rf_rule_sets_truncate ON racing_form_rule_sets;
CREATE TRIGGER trg_rf_rule_sets_truncate
    BEFORE TRUNCATE ON racing_form_rule_sets
    FOR EACH STATEMENT EXECUTE FUNCTION racing_form_no_truncate();

DROP TRIGGER IF EXISTS trg_rf_editions_truncate ON racing_form_editions;
CREATE TRIGGER trg_rf_editions_truncate
    BEFORE TRUNCATE ON racing_form_editions
    FOR EACH STATEMENT EXECUTE FUNCTION racing_form_no_truncate();

DROP TRIGGER IF EXISTS trg_rf_picks_truncate ON racing_form_picks;
CREATE TRIGGER trg_rf_picks_truncate
    BEFORE TRUNCATE ON racing_form_picks
    FOR EACH STATEMENT EXECUTE FUNCTION racing_form_no_truncate();

DROP TRIGGER IF EXISTS trg_rf_outcomes_truncate ON racing_form_race_outcomes;
CREATE TRIGGER trg_rf_outcomes_truncate
    BEFORE TRUNCATE ON racing_form_race_outcomes
    FOR EACH STATEMENT EXECUTE FUNCTION racing_form_no_truncate();

DROP TRIGGER IF EXISTS trg_rf_backtests_truncate ON racing_form_backtests;
CREATE TRIGGER trg_rf_backtests_truncate
    BEFORE TRUNCATE ON racing_form_backtests
    FOR EACH STATEMENT EXECUTE FUNCTION racing_form_no_truncate();

DROP TRIGGER IF EXISTS trg_rf_notices_truncate ON racing_form_notices;
CREATE TRIGGER trg_rf_notices_truncate
    BEFORE TRUNCATE ON racing_form_notices
    FOR EACH STATEMENT EXECUTE FUNCTION racing_form_no_truncate();

-- session_replication_role=replica 로도 꺼지지 않게
ALTER TABLE racing_form_rule_sets     ENABLE ALWAYS TRIGGER trg_rf_rule_sets_guard;
ALTER TABLE racing_form_editions      ENABLE ALWAYS TRIGGER trg_rf_editions_guard;
ALTER TABLE racing_form_picks         ENABLE ALWAYS TRIGGER trg_rf_picks_guard;
ALTER TABLE racing_form_backtests     ENABLE ALWAYS TRIGGER trg_rf_backtests_guard;
ALTER TABLE racing_form_notices       ENABLE ALWAYS TRIGGER trg_rf_notices_guard;
ALTER TABLE racing_form_race_outcomes ENABLE ALWAYS TRIGGER trg_rf_outcomes_guard;
ALTER TABLE racing_form_rule_sets     ENABLE ALWAYS TRIGGER trg_rf_rule_sets_truncate;
ALTER TABLE racing_form_editions      ENABLE ALWAYS TRIGGER trg_rf_editions_truncate;
ALTER TABLE racing_form_picks         ENABLE ALWAYS TRIGGER trg_rf_picks_truncate;
ALTER TABLE racing_form_race_outcomes ENABLE ALWAYS TRIGGER trg_rf_outcomes_truncate;
ALTER TABLE racing_form_backtests     ENABLE ALWAYS TRIGGER trg_rf_backtests_truncate;
ALTER TABLE racing_form_notices       ENABLE ALWAYS TRIGGER trg_rf_notices_truncate;

COMMIT;
