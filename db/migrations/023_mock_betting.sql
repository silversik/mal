-- mal.kr 모의배팅(가상화폐 P) 시스템
-- Source: KRA Derbyon (https://derbyon.kra.co.kr) 마권 구매 모델 디지털화
--
-- Tables:
--   user_balances         — 사용자 잔액 + 출석 + 통계 캐시 (1 user = 1 row)
--   bets                  — 한 매(=구매 1슬립). 박스/포메이션이면 여러 selection 묶음
--   bet_selections        — bet 내 펼친 단일 조합들 (정산 단위 row)
--   balance_transactions  — 잔액 원장 (idem_key UNIQUE 로 멱등성 보장)
--   race_settlements      — 같은 race 이중 정산 방지 마커
--
-- 정책 (사용자 합의):
--   가상화폐 단위: P. 가입 보너스 1,000,000P, 일일 출석 10,000P.
--   금액 단위 100P, 1매 ≤ 100,000P, 1일 ≤ 750,000P.
--   마권 7종 — WIN/PLC/QNL/QPL/EXA/TRI/TLA.
--   bet_kind ∈ STRAIGHT/BOX/FORMATION.
--
-- Depends on:
--   001_init.sql (set_updated_at trigger fn)
--   010_users_auth.sql (users 테이블)

BEGIN;

-- ============================================================================
-- 1. user_balances : 사용자 잔액 + 출석 + 통계 캐시
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_balances (
    user_id              BIGINT       PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance_p            BIGINT       NOT NULL DEFAULT 0,                  -- 보유 P
    last_attendance_date DATE,                                             -- KST 기준 마지막 출석 일자
    lifetime_bet_total_p BIGINT       NOT NULL DEFAULT 0,                  -- 통산 베팅액 (수익률 계산 캐시)
    lifetime_payout_p    BIGINT       NOT NULL DEFAULT 0,                  -- 통산 환급액
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_balance_nonneg CHECK (balance_p >= 0)
);

DROP TRIGGER IF EXISTS trg_user_balances_updated_at ON user_balances;
CREATE TRIGGER trg_user_balances_updated_at
    BEFORE UPDATE ON user_balances
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 2. bets : 한 매(=구매 1슬립). 박스/포메이션이면 bet_selections 에 펼침
-- ============================================================================
CREATE TABLE IF NOT EXISTS bets (
    id              BIGSERIAL    PRIMARY KEY,
    user_id         BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    race_date       DATE         NOT NULL,
    meet            VARCHAR(20)  NOT NULL,                                 -- 서울/제주/부경
    race_no         INT          NOT NULL,
    pool            VARCHAR(8)   NOT NULL,                                 -- WIN/PLC/QNL/QPL/EXA/TRI/TLA
    bet_kind        VARCHAR(16)  NOT NULL,                                 -- STRAIGHT/BOX/FORMATION
    -- 포메이션 메타: 슬롯별 후보 chul_no 목록. STRAIGHT/BOX 면 NULL.
    --   예: TLA 1·2·3착 축 형태 → {"slots":[[1,2],[3],[4,5,6]]}
    formation_meta  JSONB,
    unit_amount_p   BIGINT       NOT NULL,                                 -- 1조합 단위 금액
    combo_count     INT          NOT NULL,                                 -- 펼친 조합 수
    total_amount_p  BIGINT       NOT NULL,                                 -- = unit * combo_count
    status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING',                -- PENDING/SETTLED_HIT/SETTLED_MISS/VOID
    payout_p        BIGINT       NOT NULL DEFAULT 0,                       -- 정산 환급 합계
    placed_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    settled_at      TIMESTAMPTZ,

    CONSTRAINT chk_bet_pool     CHECK (pool IN ('WIN','PLC','QNL','QPL','EXA','TRI','TLA')),
    CONSTRAINT chk_bet_kind     CHECK (bet_kind IN ('STRAIGHT','BOX','FORMATION')),
    CONSTRAINT chk_bet_unit_min CHECK (unit_amount_p >= 100 AND unit_amount_p % 100 = 0),
    CONSTRAINT chk_bet_total    CHECK (total_amount_p = unit_amount_p * combo_count),
    CONSTRAINT chk_bet_status   CHECK (status IN ('PENDING','SETTLED_HIT','SETTLED_MISS','VOID')),
    CONSTRAINT chk_bet_combo    CHECK (combo_count > 0),
    CONSTRAINT chk_bet_payout   CHECK (payout_p >= 0)
);

CREATE INDEX IF NOT EXISTS idx_bets_user_placed
    ON bets (user_id, placed_at DESC);

-- 정산 잡: PENDING 만 빠르게 조회
CREATE INDEX IF NOT EXISTS idx_bets_race_pending
    ON bets (race_date, meet, race_no)
    WHERE status = 'PENDING';

-- 1일 한도 검증: KST 자정 경계 일자별 합계
CREATE INDEX IF NOT EXISTS idx_bets_user_kstdate
    ON bets (user_id, ((placed_at AT TIME ZONE 'Asia/Seoul')::date));

-- ============================================================================
-- 3. bet_selections : bet 안의 펼친 단일 조합들 (정산 단위)
-- ============================================================================
CREATE TABLE IF NOT EXISTS bet_selections (
    id           BIGSERIAL    PRIMARY KEY,
    bet_id       BIGINT       NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
    combo_index  INT          NOT NULL,                                    -- bet 내 0-based
    -- 한 조합 슬롯 1·2·3. ordered pool(EXA/TLA) 면 인덱스가 의미 있음.
    chul_no_1    INT          NOT NULL,
    chul_no_2    INT,                                                      -- WIN/PLC 만 NULL 허용
    chul_no_3    INT,                                                      -- TRI/TLA 만 사용
    is_hit       BOOLEAN,                                                  -- 정산 후 채움
    matched_odds NUMERIC(10,1),                                            -- 적중 시 캐시
    payout_p     BIGINT       NOT NULL DEFAULT 0,

    CONSTRAINT uq_bet_combo  UNIQUE (bet_id, combo_index),
    CONSTRAINT chk_sel_payout CHECK (payout_p >= 0)
);

CREATE INDEX IF NOT EXISTS idx_bet_selections_bet ON bet_selections (bet_id);

-- ============================================================================
-- 4. balance_transactions : 잔액 원장 + 멱등성 가드
-- ============================================================================
CREATE TABLE IF NOT EXISTS balance_transactions (
    id              BIGSERIAL    PRIMARY KEY,
    user_id         BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind            VARCHAR(20)  NOT NULL,                                 -- SIGNUP_GRANT/ATTENDANCE/BET_PLACED/BET_PAYOUT/BET_REFUND/ADJUST
    delta_p         BIGINT       NOT NULL,                                 -- 음수=차감, 양수=가산
    balance_after_p BIGINT       NOT NULL,                                 -- 적용 후 잔액 (디버깅용)
    ref_bet_id      BIGINT       REFERENCES bets(id) ON DELETE SET NULL,
    -- 멱등성 키: 출석=YYYY-MM-DD, 가입=user_id::text, 베팅=bet_id::text 등
    idem_key        TEXT         NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_tx_kind CHECK (kind IN ('SIGNUP_GRANT','ATTENDANCE','BET_PLACED','BET_PAYOUT','BET_REFUND','ADJUST')),
    CONSTRAINT uq_balance_tx_idem UNIQUE (user_id, kind, idem_key)
);

CREATE INDEX IF NOT EXISTS idx_balance_tx_user_created
    ON balance_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_balance_tx_bet
    ON balance_transactions (ref_bet_id) WHERE ref_bet_id IS NOT NULL;

-- ============================================================================
-- 5. race_settlements : 같은 race 이중 정산 방지 마커
-- ============================================================================
CREATE TABLE IF NOT EXISTS race_settlements (
    race_date     DATE         NOT NULL,
    meet          VARCHAR(20)  NOT NULL,
    race_no       INT          NOT NULL,
    settled_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    bets_settled  INT          NOT NULL DEFAULT 0,
    bets_void     INT          NOT NULL DEFAULT 0,

    PRIMARY KEY (race_date, meet, race_no)
);

-- scraper_jobs seed 는 통합 대시보드(crawler 스키마)에서 관리 — mal_app 은 권한 없음.
-- mal.settle_bets 잡은 JOB_CATALOG + register-dashboard-jobs CLI 가 등록.

COMMIT;
