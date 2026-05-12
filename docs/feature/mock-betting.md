# 모의배팅 시스템

가상화폐 P 기반의 7종 마권 모의배팅. 실제 돈은 오가지 않지만 KRA 확정배당율로 정산해 현실감 있는 통계를 제공한다.

## 기획 의도

- 사용자가 결과 데이터를 수동적으로 보는 것을 넘어 "예측 → 검증" 루프를 돌게 만든다.
- 잔액 · 적중률 · 풀별 통계는 사용자가 자신의 분석 안목을 추적할 수 있는 지표로 작동.

## 마권 7종 × 옵션 3종

| 풀 | 의미 | 옵션 |
|---|---|---|
| WIN | 단승 — 1착 | STRAIGHT / BOX |
| PLC | 연승 — 2착 이내 | STRAIGHT / BOX |
| QNL | 복승 — 1·2착 무순서 | STRAIGHT / BOX / FORMATION |
| QPL | 복연 — 2착 이내 2두 | STRAIGHT / BOX / FORMATION |
| EXA | 쌍승 — 1·2착 순서 | STRAIGHT / BOX / FORMATION |
| TRI | 삼복 — 1·2·3착 무순서 | STRAIGHT / BOX / FORMATION |
| TLA | 삼쌍 — 1·2·3착 순서 | STRAIGHT / BOX / FORMATION |

BOX/FORMATION 은 단일 베팅에서 여러 조합을 자동 enumerate.

## 데이터 모델 ([db/migrations/023_mock_betting.sql](../../db/migrations/023_mock_betting.sql))

```
user_balances        — user_id PK · balance_p
bets                 — id · user_id · race(date,meet,no) · pool · option · amount_p · status
bet_selections       — bet_id · seq · combo_key (개별 조합)
balance_transactions — id · user_id · kind(DEPOSIT/BET_PLACE/BET_PAYOUT/BET_REFUND/ATTENDANCE_BONUS) · delta_p
race_settlements     — race(date,meet,no) PK · settled_at (멱등성)
```

## 데이터 흐름

```
사용자 → /races 페이지 → BetForm (client) → bet-actions.ts (Server Action)
  ↓ withTransaction
  bets INSERT + bet_selections INSERT + user_balances UPDATE + balance_transactions(BET_PLACE)
  ↓
  (경주 종료 후)
  mal-crawler APScheduler `mal.settle_bets` (10분) ── POST X-Crawler-Secret ──► /api/internal/settle
                                                                                    ↓ withTransaction
                                                          race_settlements INSERT (멱등) + bets.status 변경
                                                          + 적중 시 balance_transactions(BET_PAYOUT) + balance UPDATE
                                                          + VOID 시 (combo odds 누락) → BET_REFUND
                                                                                    ↓ HTTP 응답
                                                          crawler 가 VOID 발생 시 운영자 Telegram 알림
```

## 핵심 파일

- 백엔드: [web/src/lib/db_tx.ts](../../web/src/lib/db_tx.ts) · [balances.ts](../../web/src/lib/balances.ts) · [bet_combinations.ts](../../web/src/lib/bet_combinations.ts) · [bets.ts](../../web/src/lib/bets.ts) · [settlement.ts](../../web/src/lib/settlement.ts)
- API: [web/src/app/api/internal/settle/route.ts](../../web/src/app/api/internal/settle/route.ts) (X-Crawler-Secret 인증)
- UI: [web/src/app/races/bet-form.tsx](../../web/src/app/races/bet-form.tsx) · [bet-actions.ts](../../web/src/app/races/bet-actions.ts) · [me/bets/page.tsx](../../web/src/app/me/bets/page.tsx) · [me/stats/page.tsx](../../web/src/app/me/stats/page.tsx) · [components/balance-chip.tsx](../../web/src/components/balance-chip.tsx)
- 잡: [crawler/src/jobs/periodic.py](../../crawler/src/jobs/periodic.py) `run_settle_bets`
- 자가진단: `mal.audit_combo_dividends` (매일 23:10) — 어제 결과 확정된 race 중 `race_combo_dividends` 0건 탐지 → Telegram

## 운영 의존성

- `CRAWLER_SECRET` (양쪽 컨테이너 동일 값, timing-safe equal)
- `mal.sync_race_dividends` 가 결과 확정 직후 도는 것이 정산의 전제 — 22:45 cron + 야간 청크 백필
- 출석 보너스: `/me` 의 `claimAttendanceBonusAction` (UTC date 기준)

## 한계 / 차후 후보

- 베팅 취소 (마감 전) — [docs/tasks/0001 §2-P3-(7)](../tasks/0001-phase-7-mock-betting.md#7-베팅-취소-마감-전) 후보
- placeBet rate limit (in-memory Map) — 동일 후보 (7)-(2)
- 풀별 분해 차트 (`/me/stats`) — 후보 (5)
- 적중 시 사용자별 Telegram push — 후보 (1)
- 관리자 잔액 ADJUST UI — 후보 (8)
