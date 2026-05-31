-- 모의배팅(가상화폐 P) 시스템 전면 제거 (023_mock_betting.sql 역마이그레이션).
-- 관련 코드(web/src/lib/balances.ts, bets.ts, settlement.ts, /me/bets, /me/stats,
-- /api/internal/settle, crawler.run_settle_bets 등) 도 같은 변경분에서 제거.
--
-- prod 데이터는 영구 소실. JOB_CATALOG 에서 mal.settle_bets / mal.audit_combo_dividends
-- 도 함께 제거되므로 register-dashboard-jobs 가 두 잡을 다시 등록하지 않음.

BEGIN;

DROP TABLE IF EXISTS balance_transactions;
DROP TABLE IF EXISTS bet_selections;
DROP TABLE IF EXISTS bets;
DROP TABLE IF EXISTS race_settlements;

DROP TRIGGER IF EXISTS trg_user_balances_updated_at ON user_balances;
DROP TABLE IF EXISTS user_balances;

COMMIT;
