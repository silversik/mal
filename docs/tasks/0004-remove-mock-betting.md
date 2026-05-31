# 0004 — 모의배팅 시스템 전면 제거 (2026-05-31)

Phase 7([0001](0001-phase-7-mock-betting.md))에서 도입한 가상화폐 P 기반 비현금성
모의배팅 기능을 web·crawler·DB·문서에서 통째 제거. 서비스는 KRA 데이터 조회·분석 +
커뮤니티 축만 남김.

## 1. 변경 요약

### web

| 영역 | 변경 |
|------|------|
| lib 삭제 | `balances.ts` · `bets.ts` · `settlement.ts` · `bet_combinations.ts` · `pool_style.ts` · `race_cutoff.ts` |
| 라우트 삭제 | `/me/bets` · `/me/stats` · `/api/internal/settle` |
| 컴포넌트 삭제 | `bet-form.tsx` · `balance-chip.tsx` |
| 부분 정리 | `/me` 모의배팅 카드·출석보너스 액션 / `/races` BetForm / `auth.ts` `grantSignupBonusIfNeeded` 호출 / `rate_limit` `betRateLimiter` / `/about`·`/terms`·`/privacy`·`site-footer` 안내·면책 문구 |

### crawler

- `periodic.py`: `run_settle_bets` · `run_audit_combo_dividends` 제거. `sync_yesterday_catchup` 의 정산 트리거 호출 제거
- `scheduler_main.py`: 두 잡 `add_job` · `TRIGGER_JOBS` 매핑 제거
- `main.py`: `periodic-settle-bets` CLI 제거
- `monitoring.py`: `JOB_CATALOG` 에서 `mal.settle_bets` · `mal.audit_combo_dividends` 제거 (`mock_betting` 카테고리 소멸)

### db

- [032_drop_mock_betting.sql](../../db/migrations/032_drop_mock_betting.sql): `balance_transactions` · `bet_selections` · `bets` · `race_settlements` · `user_balances` 5개 테이블 DROP (FK 의존 역순)

### infra·docs

- `docker-compose.yml` · `web/.env.example`: `CRAWLER_SECRET` · `MAL_WEB_INTERNAL_URL` 제거
- `README.md` · `CLAUDE.md` · `DESIGN.md` · `docs/spec/architecture.md` · `docs/spec/deployment.md` · `docs/feature/README.md`: 모의배팅 언급 정리. `docs/feature/mock-betting.md` 삭제

## 2. 운영 메모

- **032 마이그레이션은 비가역** — prod 의 사용자 잔액·베팅 내역 전부 영구 소실. Jenkins Migrate stage 가 자동 적용하므로, 보존이 필요하면 머지 전에 별도 백업.
- `CRAWLER_SECRET` 은 `/srv/stack/.env` 에 남아 있어도 무해(아무도 안 읽음). 정리 시 같이 제거 가능.
- `mal.settle_bets` · `mal.audit_combo_dividends` 잡은 카탈로그에서 사라지므로 `register-dashboard-jobs` 가 더 이상 등록하지 않음. 대시보드의 기존 두 잡 row 는 수동 정리 대상(과거 run 이력은 `crawler.scraper_runs` 에 남음).

## 3. 핵심 파일 빠른 참조

- 마이그레이션: [db/migrations/032_drop_mock_betting.sql](../../db/migrations/032_drop_mock_betting.sql)
- 잡 카탈로그(단일 진실원): [crawler/src/monitoring.py](../../crawler/src/monitoring.py)
- 인증(가입 보너스 제거 후): [web/src/auth.ts](../../web/src/auth.ts)

## 4. 차후 후보

- `race_combo_dividends` (복식 배당 데이터)는 **유지** — 모의배팅 정산용이 아니라 경주 상세에서 KRA 실제 배당을 보여주는 조회 기능. 혼동 주의.
- prod `/srv/stack/.env` 의 `CRAWLER_SECRET` 라인 정리(선택).
