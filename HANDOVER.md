# Handover — 모의배팅 시스템 후속 작업

**작성**: 2026-04-26
**상태**: PR1~6 머지·배포 완료. 후속 메뉴 대기 중.
**원 계획서**: `/Users/esik/.claude/plans/giggly-twirling-robin.md` (Phase 7 섹션이 본 문서의 원본)

---

## 1. 완료된 일 (요약)

KRA 경마 데이터 웹앱(`/Users/esik/Documents/mal`)에 가상화폐 P 기반 모의배팅 시스템을 신설·배포 완료.

- **마권 7종**: WIN, PLC, QNL, QPL, EXA, TRI, TLA × STRAIGHT/BOX/FORMATION
- **DB 마이그레이션 023**: `mal.user_balances`, `bets`, `bet_selections`, `balance_transactions`, `race_settlements`
- **백엔드** (`web/src/lib/`): `db_tx.ts`, `balances.ts`, `bet_combinations.ts`, `bets.ts`, `settlement.ts`
- **UI**: `/races` 인라인 베팅 폼, `/me/bets`, `/me/stats`, `BalanceChip` 헤더 칩, 출석 보너스 카드
- **정산 잡**: APScheduler `mal.settle_bets` 10분 주기 → Next.js `/api/internal/settle` (X-Crawler-Secret 인증)
- **Telegram VOID 알림**: combo 배당 누락 시 `crawler/src/jobs/periodic.py:run_settle_bets` 가 운영자에게 push
- **테스트**: vitest 41개 (settlement.test.ts, bet_combinations.test.ts)

### 운영 검증 (2026-04-26)

- 컨테이너: `mal-web` Up, `mal-crawler` Up, `stack-db` healthy
- 마이그레이션 023 적용됨
- 스케줄러 직전 실행 로그: `races=50, bets_settled=0, bets_void=0, HTTP 200`
- `mal.race_combo_dividends` 145,210건 (복식 배당 데이터 정상 — 이전 0건 보고는 오진)
- 데모: User 999 로 TRI BOX [1,3,6] @ 1,000P 베팅 → 잔액 999,000 확인

---

## 2. 후속 작업 메뉴 (P1~P4, 총 10개)

각 항목은 독립적으로 진행 가능. 우선순위는 노력 대비 임팩트 기준.

### P1 — 신뢰성/관측성 (작은 노력, 큰 효과)

#### (1) 결과 확정 후 적중 알림
- **파일**: `web/src/lib/settlement.ts`, `crawler/src/jobs/periodic.py:run_settle_bets`
- **변경**:
  - settle 응답에 `winners: [{user_id, bet_id, payout_p}]` 추가
  - crawler 에서 사용자 `telegram_chat_id` 가 있으면 push
  - **DB 마이그레이션 필요**: `mal.users.telegram_chat_id TEXT NULL` 컬럼 신설
- **재사용**: `crawler_core.client.notify_telegram` (이미 VOID 알림에서 사용 중)
- **노력**: 1일+ (마이그레이션 + 사용자 chat_id 등록 UI 까지)

#### (2) placeBet rate limiting
- **파일**: `web/src/app/races/bet-actions.ts`
- **변경**: 동일 user_id 초당 1건 / 분당 30건 제한. in-memory `Map<userId, timestamps[]>` 로 충분 (Redis 불필요)
- **이유**: 베팅은 idempotent 아님 (race_settlements 와 다름) → 더블클릭·봇 방어 서버 측 가드 필수
- **노력**: 1~2시간

#### (3) race_combo_dividends 자가진단 잡 ★ 추천 우선
- **파일**: `crawler/src/jobs/periodic.py`, `crawler/src/monitoring.py`
- **변경**:
  - 신규 잡 `mal.audit_combo_dividends` (category=`mock_betting`, expected_interval_sec=86400)
  - 어제 결과 확정된 race 중 `race_combo_dividends` 행 0인 race 탐지 → `notify_telegram`
  - APScheduler 등록 (매일 23:00 KST)
- **이유**: VOID 환급이 발생한 *후*가 아니라 *전*에 odds 누락 사전 탐지
- **재사용**: `crawler_core.client.notify_telegram`, `JOB_CATALOG` 패턴
- **노력**: 1~2시간

### P2 — UX/시각화 (중간 노력)

#### (4) 마감 카운트다운 ★ 추천 우선
- **파일**: `web/src/app/races/bet-form.tsx`
- **변경**: `start_time` 까지 남은 시간 실시간 표시. `setInterval(1000)` + 0 도달 시 폼 disabled + "마감되었습니다" 메시지
- **이유**: locked 상태 진입 사전 인지 → 패닉 베팅 방지
- **노력**: 1~2시간

#### (5) `/me/stats` 풀별 분해 + 막대 차트
- **파일**: `web/src/app/me/stats/page.tsx`, `web/src/lib/bets.ts:getUserStats`
- **변경**:
  - `getUserStats` 에 `by_pool: {WIN: {bets, hits, amount_p, payout_p}, ...}` 추가
  - 풀별(WIN/PLC/QNL/...) 적중률·회수율 막대 차트
  - 최근 30일 일자별 손익 라인 차트
  - SVG inline 으로 구현 (recharts 등 신규 의존 회피)
- **노력**: 반나절

#### (6) 베팅 내역 페이지네이션·필터
- **파일**: `web/src/app/me/bets/page.tsx`, `web/src/lib/bets.ts:getUserBets`
- **변경**:
  - 현재 `limit: 100` 하드코딩 → keyset 페이지네이션 `(placed_at, id) DESC`
  - query string 으로 풀/상태 필터 (`?pool=WIN&status=SETTLED_HIT`)
- **노력**: 반나절

### P3 — 기능 확장 (큰 노력)

#### (7) 베팅 취소 (마감 전)
- **파일**: `web/src/app/races/bet-actions.ts` (`cancelBetAction` 신규), `web/src/lib/bets.ts`, `web/src/lib/settlement.ts`
- **변경**:
  - 트랜잭션: `bets.status = 'CANCELLED'` + `balance_transactions` BET_REFUND row + 잔액 환급
  - race phase = 'pre' (마감 전)일 때만 허용
  - `settlement.ts` 의 status 체크에 'CANCELLED' 분기 추가 (정산 대상 제외)
  - DB 변경 불요 (status 컬럼 자유형 텍스트)
- **노력**: 반나절

#### (8) 관리자 페이지 — 잔액 조정/통계
- **파일**: `web/src/app/admin/` 신규 라우트
- **변경**:
  - 인증: `mal.users.is_admin BOOLEAN` 컬럼 추가 또는 환경변수 화이트리스트 user_id
  - 기능: 사용자별 잔액 ADJUST 도구, 전체 베팅량·풀별 분포 대시보드
  - 우선 조정 도구만 (대시보드는 차후)
- **노력**: 1일+

### P4 — 테스트 (잠재 결함 사전 차단)

#### (9) 동시성 race condition 테스트
- **파일**: `web/src/lib/__tests__/bets.test.ts` 신규
- **변경**: 두 트랜잭션이 동시에 잔액 직전 베팅 시 23514 → INSUFFICIENT_FUNDS 변환 확인
- **의존성**: pg-mem 또는 testcontainers 필요 (현재 단위테스트는 순수함수만)
- **노력**: 반나절

#### (10) Playwright E2E
- **파일**: `web/e2e/bet-flow.spec.ts` 신규
- **변경**:
  - 시드 user 로그인 → 베팅 → 정산 트리거 → 잔액 검증 자동화
  - `/api/internal/settle` 호출 가드: NODE_ENV=test 일 때만 X-Crawler-Secret 우회
- **노력**: 1일+

---

## 3. 추천 시작 순서

### A안: 빠른 임팩트 (반나절 안에 2건 완료)
1. **(3) combo_dividends 자가진단 잡** — 데이터 무결성 모니터링 즉시 작동
2. **(4) 마감 카운트다운** — UX 즉시 체감

### B안: UX 집중 (한 세션 반나절)
1. **(4) 마감 카운트다운**
2. **(5) /me/stats 풀별 분해**
3. **(6) 베팅 내역 페이지네이션**

### C안: 기능 확장 (하루)
1. **(7) 베팅 취소**
2. **(2) rate limiting**

---

## 4. 작업 시 주의사항

### 마이그레이션
- `mal_app` role 은 `crawler` 스키마 권한 없음 — **마이그레이션에 `scraper_jobs` seed 절대 금지**
- 잡 등록은 `crawler/src/monitoring.py` 의 `JOB_CATALOG` + `register-dashboard-jobs` CLI 단일 진실원
- 신규 마이그레이션: `db/migrations/024_*.sql` 부터

### 운영 환경
- 운영 DB 스키마는 `mal` (NOT `public`)
- 운영 호스트: SSH `mal-prod` (49.50.138.31)
- 컨테이너: `mal-web` (포트 4000), `mal-crawler`, `stack-db`
- 배포: Jenkins (`Jenkinsfile`) 자동 빌드·배포

### Next.js 16 특이사항
- `web/AGENTS.md` 명시: "이 Next.js는 당신이 아는 것과 다르다"
- Server Actions 작성 시 `node_modules/next/dist/docs/` 가이드 확인 필수
- 기존 `web/src/app/me/actions.ts` 스타일 그대로 따름

### 검증 공통
- 신규 코드: `npm run -C web test` (vitest) + `npm run -C web typecheck`
- UI: `preview_start` → 시나리오 클릭 → `preview_screenshot` 첨부
- 크롤러 잡: `docker exec mal-crawler uv run python -m src.main register-dashboard-jobs` 후 대시보드 확인

### 커밋
- 1커밋 1논리변경, 한국어 `Type: 요약` 형식 (예: `Feat: 마감 카운트다운 표시`)
- 작업 종료 시 `git status` 확인 후 커밋 전략 자동 제안

---

## 5. 핵심 파일 빠른 참조

```
web/src/lib/
  ├ db_tx.ts              — withTransaction 헬퍼
  ├ balances.ts           — 잔액·출석·일일한도
  ├ bet_combinations.ts   — 풀별 조합 enumerate (순수함수)
  ├ bets.ts               — placeBet, getUserBets, getUserStats
  └ settlement.ts         — settleRace, isHit, lookupOdds, settlePendingForFinishedRaces

web/src/app/
  ├ api/internal/settle/route.ts   — POST 정산 endpoint
  ├ races/bet-form.tsx             — 베팅 폼 클라이언트 컴포넌트
  ├ races/bet-actions.ts           — placeBetAction Server Action
  ├ me/bets/page.tsx               — 베팅 내역
  ├ me/stats/page.tsx              — 베팅 통계
  └ me/actions.ts                  — claimAttendanceBonusAction

web/src/components/
  └ balance-chip.tsx               — 헤더 잔액 표시

crawler/src/
  ├ jobs/periodic.py               — run_settle_bets (HTTP 트리거 + Telegram VOID)
  ├ monitoring.py                  — JOB_CATALOG (mal.settle_bets)
  └ scheduler_main.py              — APScheduler 등록 (10분 주기)

db/migrations/
  └ 023_mock_betting.sql
```

---

다음 세션 시작 시 이 문서를 읽고 사용자에게 어떤 항목부터 진행할지 물어보면 됨.
